import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { Strategy, VerifyCallback } from 'passport-google-oauth20';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { RbacService } from '../../rbac/rbac.service';
import { JwtService } from '@nestjs/jwt';

/**
 * Google OAuth2 strategy — buyers only.
 * On first login: creates user + buyer_profile automatically.
 * On subsequent logins: looks up existing user by email.
 */
@Injectable()
export class GoogleStrategy extends PassportStrategy(Strategy, 'google') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly rbacService: RbacService,
    private readonly jwtService: JwtService,
  ) {
    super({
      clientID:     config.getOrThrow('GOOGLE_CLIENT_ID'),
      clientSecret: config.getOrThrow('GOOGLE_CLIENT_SECRET'),
      callbackURL:  config.getOrThrow('GOOGLE_CALLBACK_URL'),
      scope: ['email', 'profile'],
    });
  }

  async validate(
    _accessToken: string,
    _refreshToken: string,
    profile: any,
    done: VerifyCallback,
  ): Promise<void> {
    const email: string = profile.emails?.[0]?.value;
    if (!email) return done(new Error('No email from Google profile'), undefined);

    let user = await this.prisma.user.findUnique({ where: { email } });

    if (!user) {
      // First-time Google sign-in: create user + BUYER role + buyer profile
      const buyerRole = await this.prisma.role.findUniqueOrThrow({ where: { name: 'BUYER' } });
      user = await this.prisma.user.create({
        data: {
          email,
          passwordHash: 'OAUTH_NO_PASSWORD', // no password for OAuth users
          status:          'ACTIVE',
          emailVerifiedAt: new Date(),
          userRoles: { create: { roleId: buyerRole.id } },
          buyerProfile: {
            create: {
              displayName: profile.displayName ?? email.split('@')[0],
              buyerType:   'DOMESTIC_OTHER_REGION', // default; updated by buyer on profile setup
            },
          },
        },
      });
    }

    const [roles, permissions, regionIds] = await Promise.all([
      this.rbacService.resolveUserRoles(user.id),
      this.rbacService.resolveUserPermissions(user.id),
      this.rbacService.resolveUserRegionIds(user.id),
    ]);

    const accessToken = this.jwtService.sign({
      sub: user.id, email: user.email, roles, regionIds, permissions, mfaVerified: false,
    });

    done(null, { accessToken });
  }
}
