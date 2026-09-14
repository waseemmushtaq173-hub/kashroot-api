import { Injectable, UnauthorizedException } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import * as argon2 from 'argon2';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class RefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (req: Request) => req?.cookies?.['refresh_token'],
      ]),
      ignoreExpiration: false,
      secretOrKey: config.getOrThrow<string>('JWT_REFRESH_SECRET'),
      passReqToCallback: true,
    });
  }

  async validate(req: Request, payload: any) {
    const rawToken: string | undefined = req.cookies?.['refresh_token'];
    if (!rawToken) throw new UnauthorizedException('No refresh token');

    // Find non-revoked tokens for this user and check hash
    const storedTokens = await this.prisma.refreshToken.findMany({
      where: {
        userId: payload.sub,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
    });

    let matched: (typeof storedTokens)[0] | undefined;
    for (const t of storedTokens) {
      if (await argon2.verify(t.tokenHash, rawToken)) {
        matched = t;
        break;
      }
    }

    if (!matched) {
      throw new UnauthorizedException('Refresh token invalid or revoked');
    }

    return { sub: payload.sub, refreshTokenId: matched.id };
  }
}
