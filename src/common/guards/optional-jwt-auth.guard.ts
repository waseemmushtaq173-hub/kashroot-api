import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AuthenticatedUser } from '../types/request-with-user.type';

/**
 * Best-effort authentication: attaches request.user when a valid bearer token is
 * present, and does nothing when it is not.
 *
 * WHY NOT REUSE JwtAuthGuard
 * --------------------------
 * It cannot be reused here. JwtAuthGuard.canActivate() returns true immediately
 * for a route marked @Public() and never invokes passport, so request.user is
 * never populated. On a route that is public *and* identity-aware, that means an
 * owner's token is silently ignored and they get the same 404 as a stranger —
 * exactly the case this guard exists to serve.
 *
 * Unlike JwtAuthGuard, a failure is not an error here. Routes using this are
 * public by design, so "no identity" is a valid outcome rather than a rejection.
 */
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  /**
   * Overrides the base implementation, which throws UnauthorizedException when
   * there is no user.
   *
   * Every failure mode funnels through here and is treated the same way: no
   * Authorization header provided, malformed or expired token, wrong signature,
   * or a token for an account that is no longer ACTIVE (the strategy throws for
   * that last one). None of them should turn an otherwise public read into a 401,
   * so the identity is left unset and the request continues anonymously.
   */
  handleRequest<TUser = AuthenticatedUser>(
    _err: unknown,
    user: TUser,
  ): TUser | undefined {
    return user ?? undefined;
  }
}
