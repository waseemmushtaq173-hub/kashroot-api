import {
  Injectable,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
} from '@nestjs/common';
import { ServiceAccountsService } from '../service-accounts.service';

/**
 * ServiceAccountGuard
 *
 * Guards routes that require machine-identity authentication.
 * Intended for INTERNAL service-to-service calls only.
 *
 * Wire-up:
 *   - Decorator: @UseGuards(ServiceAccountGuard)
 *   - Or globally for specific endpoints via app.module guard config.
 *
 * Auth scheme:
 *   Authorization: Bearer <accountId>:<rawApiKey>
 *
 * The service account is attached to req.serviceAccount after validation.
 *
 * NOT for external payment webhooks (e.g. Razorpay):
 *   External webhooks use provider-signed HMAC-SHA256 verification.
 *   See Module 4 payments.service.ts verifyWebhookSignature() for that pattern.
 *
 * Follow-up action (tracked, not silently left inconsistent):
 *   Audit Module 4\'s webhook handler to confirm it uses HMAC-SHA256 provider
 *   signature verification and does NOT accept a raw service-account key.
 */
@Injectable()
export class ServiceAccountGuard implements CanActivate {
  constructor(
    private readonly serviceAccountsService: ServiceAccountsService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers['authorization'];

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw new UnauthorizedException(
        'Service account authentication required. ' +
        'Provide Authorization: Bearer <accountId>:<rawApiKey>',
      );
    }

    const token = authHeader.slice('Bearer '.length).trim();

    try {
      const account = await this.serviceAccountsService.validateApiKey(token);
      request.serviceAccount = account;
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or revoked service account credentials.');
    }
  }
}
