import {
  Injectable,
  OnModuleInit,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { MailService } from '../mail/mail.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import { RoleName } from '@prisma/client';
import * as argon2 from 'argon2';
import * as QRCode from 'qrcode';
import { authenticator } from 'otplib';
import {
  randomBytes,
  randomInt,
  timingSafeEqual,
} from 'crypto';
import { Response } from 'express';
import { FieldEncryptionService } from '../../common/utils/field-encryption.service';

/**
 * Roles a user may assign to themselves at registration.
 * RegisterDto.role is a free-form string, so without this allowlist a caller
 * could request SUPER_ADMIN and be granted it.
 */
const SELF_REGISTERABLE_ROLES: readonly RoleName[] = ['FARMER', 'BUYER', 'SELLER'];

/** Default buyer classification until the buyer completes profile setup. */
const DEFAULT_BUYER_TYPE = 'DOMESTIC_OTHER_REGION' as const;

const OTP_STORE = new Map<string, { code: string; expiresAt: Date }>();

@Injectable()
export class AuthService implements OnModuleInit {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly rbacService: RbacService,
    private readonly mailService: MailService,
    private readonly encryption: FieldEncryptionService,
  ) {}

  /**
   * Providers are initialised before the HTTP server starts accepting
   * connections, so validating the encryption key here turns a malformed key
   * into a startup failure with a clear message, instead of a 500 on the first
   * MFA request from a user who has no idea why.
   */
  onModuleInit(): void {
    this.encryption.getEncryptionKey();
  }

  async register(dto: RegisterDto): Promise<{ message: string }> {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('email or phone is required');
    }

    const requestedRole = (dto.role ?? '').toUpperCase() as RoleName;
    if (!SELF_REGISTERABLE_ROLES.includes(requestedRole)) {
      throw new BadRequestException(
        `role must be one of: ${SELF_REGISTERABLE_ROLES.join(', ')}`,
      );
    }

    if (dto.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing) throw new ConflictException('Email already registered');
    }
    if (dto.phone) {
      const existing = await this.prisma.user.findUnique({ where: { phone: dto.phone } });
      if (existing) throw new ConflictException('Phone already registered');
    }

    const passwordHash = await argon2.hash(dto.password, {
      type: argon2.argon2id,
      memoryCost: parseInt(this.config.get('ARGON2_MEMORY_COST', '65536')),
      timeCost:   parseInt(this.config.get('ARGON2_TIME_COST', '3')),
      parallelism: parseInt(this.config.get('ARGON2_PARALLELISM', '4')),
    });

    // Roles are reference data created by seed/seed.ts. Without this row the
    // user would be created with an empty permission set.
    const role = await this.prisma.role.findUnique({ where: { name: requestedRole } });
    if (!role) {
      this.logger.error(`Role ${requestedRole} is missing from the database. Run seed/seed.ts.`);
      throw new InternalServerErrorException('Role configuration missing.');
    }

    const displayName = dto.fullName?.trim() || dto.email?.split('@')[0] || dto.phone || 'KashRoot user';

    await this.prisma.user.create({
      data: {
        email: dto.email,
        phone: dto.phone,
        passwordHash,
        status: 'PENDING_VERIFICATION',
        userRoles: { create: { roleId: role.id } },
        ...this.profileForRole(requestedRole, displayName),
      },
    });

    await this.sendOtp(dto.email ?? dto.phone!);

    // The OTP is deliberately NOT returned here: echoing it would let a caller
    // activate any account they just registered without access to the inbox.
    return { message: 'Registration successful. Please verify your account with the OTP sent.' };
  }

  /**
   * The nested profile row that belongs with a self-registered role.
   *
   * Written as an exhaustive switch rather than a FARMER/else ternary: the
   * ternary sent every non-farmer down the buyer branch, so adding SELLER to
   * SELF_REGISTERABLE_ROLES would have silently given each new seller a
   * BuyerProfile and no SellerProfile. FARMER and BUYER produce exactly the
   * rows they did before.
   *
   * SELF_REGISTERABLE_ROLES is validated by the caller, so the default is
   * unreachable; it throws rather than guessing a profile for a role nobody
   * has mapped yet.
   */
  private profileForRole(role: RoleName, displayName: string) {
    switch (role) {
      case 'FARMER':
        return { farmerProfile: { create: { displayName } } };
      case 'BUYER':
        return { buyerProfile: { create: { displayName, buyerType: DEFAULT_BUYER_TYPE } } };
      case 'SELLER':
        // SellerProfile.businessName is required and the registration form
        // collects only a name, so the display name stands in until the seller
        // completes profile setup.
        return { SellerProfile: { create: { businessName: displayName } } };
      default:
        this.logger.error(`No profile mapping for self-registerable role ${role}.`);
        throw new InternalServerErrorException('Role configuration missing.');
    }
  }

  /**
   * Generates, stores and delivers a one-time code.
   * Returns the code for internal callers only — never place it in an HTTP response.
   */
  async sendOtp(target: string): Promise<string> {
    const code = randomInt(100000, 1000000).toString();
    const expiryMin = parseInt(this.config.get('OTP_EXPIRY_MINUTES', '10'));
    const expiresAt = new Date(Date.now() + expiryMin * 60_000);

    this.sweepExpiredOtps();
    OTP_STORE.set(target, { code, expiresAt });

    if (target.includes('@')) {
      try {
        await this.mailService.sendMail(
          target,
          'Your KashRoot Verification Code',
          `<h2>Welcome to KashRoot</h2><p>Your verification code is: <b>${code}</b></p><p>This code expires in ${expiryMin} minutes.</p>`,
        );
      } catch (err) {
        // A mail outage must not fail registration; the code remains stored.
        this.logger.error(`Failed to send OTP email to ${target}: ${(err as Error).message}`);
      }
    } else {
      this.logger.warn('SMS OTP delivery is not implemented; code stored but not delivered.');
    }

    // DEV ONLY. Outside production the code is also written to the console so
    // registration is workable without a functioning mail provider. This must
    // never run in production, where logging a live credential is a leak.
    if (this.config.get('NODE_ENV') !== 'production') {
      console.log(`[DEV OTP] ${target} -> ${code} (expires in ${expiryMin}m)`);
    }

    return code;
  }

  private sweepExpiredOtps(): void {
    const now = new Date();
    for (const [key, entry] of OTP_STORE) {
      if (entry.expiresAt < now) OTP_STORE.delete(key);
    }
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ message: string }> {
    const key = dto.email ?? dto.phone;
    if (!key) throw new BadRequestException('email or phone required');

    const stored = OTP_STORE.get(key);
    if (!stored || stored.expiresAt < new Date() || !this.codesMatch(stored.code, dto.code)) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    OTP_STORE.delete(key);

    const update: Record<string, unknown> = { status: 'ACTIVE' };
    if (dto.email) update.emailVerifiedAt = new Date();
    if (dto.phone) update.phoneVerifiedAt = new Date();

    await this.prisma.user.update({
      where: dto.email ? { email: dto.email } : { phone: dto.phone },
      data: update,
    });
    return { message: 'Account verified successfully.' };
  }

  private codesMatch(expected: string, supplied: string): boolean {
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(supplied ?? '', 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  async forgotPassword(email: string): Promise<{ message: string }> {
    // The response is identical whether or not the account exists, so this
    // endpoint cannot be used to enumerate registered addresses.
    const generic = {
      message: 'If an account with that email exists, password reset instructions have been sent.',
    };

    const user = await this.prisma.user.findUnique({ where: { email } });
    if (!user) return generic;

    // NOTE: this token is not persisted anywhere, and no reset endpoint exists
    // yet — password reset cannot actually be completed. Persisting it needs a
    // store (Redis or an OtpChallenge/PasswordResetToken table) and is tracked
    // as its own fix.
    const resetToken = randomBytes(32).toString('hex');

    try {
      await this.mailService.sendMail(
        email,
        'KashRoot Password Reset Instructions',
        `<h2>Password Reset Request</h2><p>Your password reset token is: <b>${resetToken}</b></p><p>If you did not request this, please ignore this email.</p>`,
      );
    } catch (err) {
      this.logger.error(`Failed to send reset email to ${email}: ${(err as Error).message}`);
    }

    return generic;
  }

  async login(
    dto: LoginDto,
    meta: { ip?: string; userAgent?: string },
    res: Response,
  ): Promise<{ accessToken: string; user: Record<string, unknown> }> {
    const user = dto.email
      ? await this.prisma.user.findUnique({ where: { email: dto.email } })
      : await this.prisma.user.findUnique({ where: { phone: dto.phone } });

    if (!user)                                   throw new UnauthorizedException('Invalid credentials');
    if (user.status === 'DELETED')               throw new UnauthorizedException('Account not found');
    if (user.status === 'SUSPENDED')             throw new ForbiddenException('Account suspended. Contact support.');
    if (user.status === 'PENDING_VERIFICATION') {
      throw new UnauthorizedException('Please verify your account first');
    }

    // OAuth-created accounts carry a non-argon2 placeholder hash. argon2.verify
    // rejects on a malformed hash rather than returning false, so an unguarded
    // call turns a bad login into a 500.
    let passwordMatch = false;
    try {
      passwordMatch = await argon2.verify(user.passwordHash, dto.password);
    } catch {
      passwordMatch = false;
    }
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    const roles = await this.rbacService.resolveUserRoles(user.id);
    const requiresMfa = user.mfaEnabled;
    if (requiresMfa) {
      if (!dto.totpCode) {
        throw new UnauthorizedException('MFA_REQUIRED');
      }
      const secret = this.decryptMfaSecret(user.mfaSecret!);
      const valid = authenticator.verify({ token: dto.totpCode, secret });
      if (!valid) throw new UnauthorizedException('Invalid MFA code');
    }

    const privilegedRoles = ['SUPER_ADMIN', 'REGIONAL_ADMIN'] as const;
    const isPrivileged = roles.some((r) => (privilegedRoles as readonly string[]).includes(r));
    if (isPrivileged && !user.mfaEnabled) {
      throw new ForbiddenException(
        'MFA_ENROLLMENT_REQUIRED: Privileged accounts must complete MFA setup before logging in.',
      );
    }

    const [permissions, regionIds] = await Promise.all([
      this.rbacService.resolveUserPermissions(user.id),
      this.rbacService.resolveUserRegionIds(user.id),
    ]);

    const accessPayload = {
      sub:        user.id,
      email:      user.email,
      phone:      user.phone,
      roles,
      regionIds,
      permissions,
      mfaVerified: requiresMfa,
    };
    const accessToken = this.jwtService.sign(accessPayload, {
      secret:    this.config.getOrThrow('JWT_ACCESS_SECRET'),
      expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m'),
    });

    const rawRefresh = randomBytes(64).toString('hex');
    const tokenHash  = await argon2.hash(rawRefresh, { type: argon2.argon2id });
    const refreshTtlMs = this.parseMs(this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'));
    const expiresAt  = new Date(Date.now() + refreshTtlMs);
    await this.prisma.refreshToken.create({
      data: {
        userId:    user.id,
        tokenHash,
        deviceInfo: { userAgent: meta.userAgent },
        ipAddress:  meta.ip,
        expiresAt,
      },
    });

    res.cookie('refresh_token', rawRefresh, {
      httpOnly:  true,
      secure:    this.config.get('NODE_ENV') === 'production',
      sameSite:  'strict',
      maxAge:    refreshTtlMs,
      path:      '/api/v1/auth',
    });

    await this.prisma.user.update({
      where: { id: user.id },
      data:  { lastLoginAt: new Date() },
    });

    return {
      accessToken,
      user: {
        id:     user.id,
        email:  user.email,
        phone:  user.phone,
        roles,
        mfaEnabled: user.mfaEnabled,
      },
    };
  }

  async refresh(
    userId: string,
    refreshTokenId: string,
    res: Response,
  ): Promise<{ accessToken: string }> {
    await this.prisma.refreshToken.update({
      where: { id: refreshTokenId },
      data:  { revokedAt: new Date() },
    });

    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.status !== 'ACTIVE') throw new UnauthorizedException('Account not active');

    const [roles, permissions, regionIds] = await Promise.all([
      this.rbacService.resolveUserRoles(userId),
      this.rbacService.resolveUserPermissions(userId),
      this.rbacService.resolveUserRegionIds(userId),
    ]);

    const accessToken = this.jwtService.sign(
      { sub: userId, email: user.email, phone: user.phone, roles, regionIds, permissions, mfaVerified: user.mfaEnabled },
      { secret: this.config.getOrThrow('JWT_ACCESS_SECRET'), expiresIn: this.config.get('JWT_ACCESS_EXPIRES_IN', '15m') },
    );

    const rawRefresh = randomBytes(64).toString('hex');
    const tokenHash  = await argon2.hash(rawRefresh, { type: argon2.argon2id });
    const refreshTtlMs = this.parseMs(this.config.get('JWT_REFRESH_EXPIRES_IN', '30d'));
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt: new Date(Date.now() + refreshTtlMs) },
    });

    res.cookie('refresh_token', rawRefresh, {
      httpOnly: true,
      secure:   this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge:   refreshTtlMs,
      path:     '/api/v1/auth',
    });

    return { accessToken };
  }

  async logout(refreshTokenId: string, res: Response): Promise<{ message: string }> {
    await this.prisma.refreshToken.update({
      where: { id: refreshTokenId },
      data:  { revokedAt: new Date() },
    });
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    return { message: 'Logged out successfully.' };
  }

  async logoutAll(userId: string, res: Response): Promise<{ message: string }> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data:  { revokedAt: new Date() },
    });
    res.clearCookie('refresh_token', { path: '/api/v1/auth' });
    return { message: 'Logged out from all devices.' };
  }

  async setupMfa(
    userId: string,
  ): Promise<{ otpauthUrl: string; qrCodeDataUrl: string; secret: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw new BadRequestException('MFA already enabled');

    const secret = authenticator.generateSecret();
    const issuer = this.config.get('TOTP_ISSUER', 'KashRoot');
    const label  = user.email ?? user.phone ?? userId;
    const otpauthUrl = authenticator.keyuri(label, issuer, secret);

    // The client renders this straight into an <img src>, so the QR has to be
    // produced here — an otpauth:// URL is not displayable on its own.
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl);

    const encryptedSecret = this.encryptMfaSecret(secret);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { mfaSecret: encryptedSecret },
    });

    return { otpauthUrl, qrCodeDataUrl, secret };
  }

  async verifyMfaSetup(userId: string, totpCode: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaSecret) throw new BadRequestException('MFA setup not initiated');
    if (user.mfaEnabled) throw new BadRequestException('MFA already enabled');

    const secret = this.decryptMfaSecret(user.mfaSecret);
    const valid  = authenticator.verify({ token: totpCode, secret });
    if (!valid) throw new UnauthorizedException('Invalid TOTP code');

    await this.prisma.user.update({
      where: { id: userId },
      data:  { mfaEnabled: true },
    });
    return { message: 'MFA enabled successfully.' };
  }

  async disableMfa(userId: string, totpCode: string): Promise<{ message: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!user.mfaEnabled || !user.mfaSecret) throw new BadRequestException('MFA not enabled');

    const secret = this.decryptMfaSecret(user.mfaSecret);
    const valid  = authenticator.verify({ token: totpCode, secret });
    if (!valid) throw new UnauthorizedException('Invalid TOTP code');

    const roles = await this.rbacService.resolveUserRoles(userId);
    if (roles.includes('SUPER_ADMIN') || roles.includes('REGIONAL_ADMIN')) {
      throw new ForbiddenException('Privileged accounts cannot disable MFA');
    }

    await this.prisma.user.update({
      where: { id: userId },
      data:  { mfaEnabled: false, mfaSecret: null },
    });
    return { message: 'MFA disabled.' };
  }

  /**
   * TOTP seeds and KYC bank account numbers share one key, format and
   * validation path — see FieldEncryptionService, which these two methods were
   * extracted into. The stored bytes are unchanged, so secrets written by
   * earlier builds still decrypt.
   */
  private encryptMfaSecret(plaintext: string): Buffer {
    return this.encryption.encrypt(plaintext);
  }

  private decryptMfaSecret(data: Buffer): string {
    return this.encryption.decrypt(data);
  }

  private parseMs(duration: string): number {
    const unit  = duration.slice(-1);
    const value = parseInt(duration.slice(0, -1));
    const map: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return value * (map[unit] ?? 1000);
  }
}
