import {
  Injectable,
  BadRequestException,
  UnauthorizedException,
  ConflictException,
  ForbiddenException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { RbacService } from '../rbac/rbac.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyOtpDto } from './dto/verify-otp.dto';
import * as argon2 from 'argon2';
import { authenticator } from 'otplib';
import { randomBytes, createCipheriv, createDecipheriv } from 'crypto';
import { Response } from 'express';

// ─────────────────────────────────────────────────────────────────────────────
// OTP store — replace with Redis in production.
// Key: email|phone → { code, expiresAt }
// ─────────────────────────────────────────────────────────────────────────────
const OTP_STORE = new Map<string, { code: string; expiresAt: Date }>();

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly rbacService: RbacService,
  ) {}

  // ──────────────────────────────────────────────────────────────────────────
  // REGISTRATION
  // ──────────────────────────────────────────────────────────────────────────

  async register(dto: RegisterDto): Promise<{ message: string }> {
    if (!dto.email && !dto.phone) {
      throw new BadRequestException('email or phone is required');
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

    await this.prisma.user.create({
      data: { email: dto.email, phone: dto.phone, passwordHash, status: 'PENDING_VERIFICATION' },
    });

    await this.sendOtp(dto.email ?? dto.phone!);
    return { message: 'Registration successful. Please verify your account with the OTP sent.' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // OTP
  // ──────────────────────────────────────────────────────────────────────────

  async sendOtp(target: string): Promise<void> {
    const code = Math.floor(100000 + Math.random() * 900000).toString();
    const expiryMin = parseInt(this.config.get('OTP_EXPIRY_MINUTES', '10'));
    const expiresAt = new Date(Date.now() + expiryMin * 60_000);
    OTP_STORE.set(target, { code, expiresAt });
    // TODO: dispatch via NotificationsService (email/SMS channel)
    // In dev, log to stdout for testing; never log in production.
    if (this.config.get('NODE_ENV') !== 'production') {
      console.log(`[DEV OTP] ${target} → ${code}`);
    }
  }

  async verifyOtp(dto: VerifyOtpDto): Promise<{ message: string }> {
    const key = dto.email ?? dto.phone;
    if (!key) throw new BadRequestException('email or phone required');

    const stored = OTP_STORE.get(key);
    if (!stored || stored.code !== dto.code || stored.expiresAt < new Date()) {
      throw new UnauthorizedException('Invalid or expired OTP');
    }
    OTP_STORE.delete(key);

    const update: Record<string, unknown> = { status: 'ACTIVE' };
    if (dto.email)  update.emailVerifiedAt = new Date();
    if (dto.phone)  update.phoneVerifiedAt = new Date();

    await this.prisma.user.update({
      where: dto.email ? { email: dto.email } : { phone: dto.phone },
      data: update,
    });
    return { message: 'Account verified successfully.' };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LOGIN
  // ──────────────────────────────────────────────────────────────────────────

  async login(
    dto: LoginDto,
    meta: { ip?: string; userAgent?: string },
    res: Response,
  ): Promise<{ accessToken: string; user: Record<string, unknown> }> {
    const user = dto.email
      ? await this.prisma.user.findUnique({ where: { email: dto.email } })
      : await this.prisma.user.findUnique({ where: { phone: dto.phone } });

    if (!user)                             throw new UnauthorizedException('Invalid credentials');
    if (user.status === 'DELETED')         throw new UnauthorizedException('Account not found');
    if (user.status === 'SUSPENDED')       throw new ForbiddenException('Account suspended. Contact support.');
    if (user.status === 'PENDING_VERIFICATION') {
      throw new UnauthorizedException('Please verify your account first');
    }

    const passwordMatch = await argon2.verify(user.passwordHash, dto.password);
    if (!passwordMatch) throw new UnauthorizedException('Invalid credentials');

    // ── MFA check ────────────────────────────────────────────────────────────
    // Mandatory for SUPER_ADMIN / REGIONAL_ADMIN if MFA is enrolled.
    // For users with mfa_enabled=true, totpCode is always required.
    const roles = await this.rbacService.resolveUserRoles(user.id);
    const requiresMfa = user.mfaEnabled;
    if (requiresMfa) {
      if (!dto.totpCode) {
        throw new UnauthorizedException('MFA_REQUIRED'); // client checks this code
      }
      const secret = this.decryptMfaSecret(user.mfaSecret!);
      const valid = authenticator.verify({ token: dto.totpCode, secret });
      if (!valid) throw new UnauthorizedException('Invalid MFA code');
    }

    // Enforce MFA enrollment for privileged roles even if not yet set up
    const privilegedRoles = ['SUPER_ADMIN', 'REGIONAL_ADMIN'] as const;
    const isPrivileged = roles.some((r) => (privilegedRoles as readonly string[]).includes(r));
    if (isPrivileged && !user.mfaEnabled) {
      throw new ForbiddenException(
        'MFA_ENROLLMENT_REQUIRED: Privileged accounts must complete MFA setup before logging in.',
      );
    }

    // ── Resolve permissions + region scopes ─────────────────────────────────
    const [permissions, regionIds] = await Promise.all([
      this.rbacService.resolveUserPermissions(user.id),
      this.rbacService.resolveUserRegionIds(user.id),
    ]);

    // ── Issue access token (15 min) ──────────────────────────────────────────
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

    // ── Issue + store refresh token (30d) ────────────────────────────────────
    const rawRefresh = randomBytes(64).toString('hex');
    const tokenHash  = await argon2.hash(rawRefresh, { type: argon2.argon2id });
    const expiresAt  = new Date(
      Date.now() + this.parseMs(this.config.get('JWT_REFRESH_EXPIRES_IN', '30d')),
    );
    await this.prisma.refreshToken.create({
      data: {
        userId:    user.id,
        tokenHash,
        deviceInfo: { userAgent: meta.userAgent },
        ipAddress:  meta.ip,
        expiresAt,
      },
    });

    // ── Set httpOnly secure cookie ───────────────────────────────────────────
    res.cookie('refresh_token', rawRefresh, {
      httpOnly:  true,
      secure:    this.config.get('NODE_ENV') === 'production',
      sameSite:  'strict',
      maxAge:    30 * 24 * 60 * 60 * 1000, // 30 days ms
      path:      '/api/v1/auth',
    });

    // Update last login
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

  // ──────────────────────────────────────────────────────────────────────────
  // TOKEN REFRESH
  // ──────────────────────────────────────────────────────────────────────────

  async refresh(
    userId: string,
    refreshTokenId: string,
    res: Response,
  ): Promise<{ accessToken: string }> {
    // Revoke old token (rotation)
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

    // Issue new refresh token
    const rawRefresh = randomBytes(64).toString('hex');
    const tokenHash  = await argon2.hash(rawRefresh, { type: argon2.argon2id });
    const expiresAt  = new Date(Date.now() + this.parseMs(this.config.get('JWT_REFRESH_EXPIRES_IN', '30d')));
    await this.prisma.refreshToken.create({
      data: { userId, tokenHash, expiresAt },
    });

    res.cookie('refresh_token', rawRefresh, {
      httpOnly: true,
      secure:   this.config.get('NODE_ENV') === 'production',
      sameSite: 'strict',
      maxAge:   30 * 24 * 60 * 60 * 1000,
      path:     '/api/v1/auth',
    });

    return { accessToken };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // LOGOUT
  // ──────────────────────────────────────────────────────────────────────────

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

  // ──────────────────────────────────────────────────────────────────────────
  // MFA SETUP (TOTP)
  // ──────────────────────────────────────────────────────────────────────────

  async setupMfa(userId: string): Promise<{ otpauthUrl: string; secret: string }> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (user.mfaEnabled) throw new BadRequestException('MFA already enabled');

    const secret = authenticator.generateSecret();
    const issuer = this.config.get('TOTP_ISSUER', 'KashRoot');
    const label  = user.email ?? user.phone ?? userId;
    const otpauthUrl = authenticator.keyuri(label, issuer, secret);

    // Store secret encrypted (not yet activated — activation on verify-setup)
    const encryptedSecret = this.encryptMfaSecret(secret);
    await this.prisma.user.update({
      where: { id: userId },
      data:  { mfaSecret: encryptedSecret },
    });

    return { otpauthUrl, secret };
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

    // Privileged roles cannot disable MFA
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

  // ──────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ──────────────────────────────────────────────────────────────────────────

  private encryptMfaSecret(plaintext: string): Buffer {
    const key = Buffer.from(this.config.getOrThrow('ENCRYPTION_KEY'), 'hex');
    const iv  = randomBytes(16);
    const cipher = createCipheriv('aes-256-cbc', key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return Buffer.concat([iv, encrypted]); // prepend iv for decryption
  }

  private decryptMfaSecret(data: Buffer): string {
    const key       = Buffer.from(this.config.getOrThrow('ENCRYPTION_KEY'), 'hex');
    const iv        = data.subarray(0, 16);
    const encrypted = data.subarray(16);
    const decipher  = createDecipheriv('aes-256-cbc', key, iv);
    return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
  }

  /** Parse duration strings like '30d', '15m', '1h' to milliseconds. */
  private parseMs(duration: string): number {
    const unit  = duration.slice(-1);
    const value = parseInt(duration.slice(0, -1));
    const map: Record<string, number> = { s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 };
    return value * (map[unit] ?? 1000);
  }
}
