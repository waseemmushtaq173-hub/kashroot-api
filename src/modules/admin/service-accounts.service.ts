import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import * as bcrypt from 'bcrypt';
import { randomBytes } from 'crypto';

/**
 * ServiceAccountsService
 *
 * Machine identities for service-to-service auth.
 * Entirely separate from the users table.
 *
 * api_key_hash = bcrypt hash of the raw API key.
 * Raw key is returned ONCE on creation and never stored.
 *
 * revoked_at = NULL means the account is active.
 *
 * Usage in auth:
 *   1. Client sends raw key in Authorization: Bearer <key> header.
 *   2. ServiceAccountGuard extracts it, calls validateApiKey(),
 *      and attaches the service account to the request.
 *
 * NOTE: Module 4\'s Razorpay webhook uses HMAC-SHA256 signature verification,
 * which is the standard for external payment providers and does NOT use this
 * guard (external providers cannot use internal API keys).
 * ServiceAccountGuard is for INTERNAL service-to-service calls only
 * (e.g. background workers, queue processors, internal microservices).
 * Follow-up: audit Module 4 webhook handler to confirm it uses provider-signed
 * HMAC and not a raw service-account key.
 */
@Injectable()
export class ServiceAccountsService {
  private readonly logger = new Logger(ServiceAccountsService.name);
  private readonly BCRYPT_ROUNDS = 12;

  constructor(private readonly prisma: PrismaService) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────

  /**
   * createServiceAccount
   * @returns { account, rawApiKey } — rawApiKey is returned ONCE only.
   */
  async createServiceAccount(name: string, scope: string[]) {
    const existing = await this.prisma.serviceAccount.findUnique({ where: { name } });
    if (existing) {
      throw new ConflictException(`Service account "${name}" already exists.`);
    }

    const rawKey    = randomBytes(32).toString('hex'); // 64-char hex key
    const apiKeyHash = await bcrypt.hash(rawKey, this.BCRYPT_ROUNDS);

    const account = await this.prisma.serviceAccount.create({
      data: { name, scope: JSON.stringify(scope), apiKeyHash },
    });

    this.logger.log(`ServiceAccount "${name}" created (id=${account.id})`);
    return { account, rawApiKey: rawKey };
  }

  // ─── VALIDATE (used by ServiceAccountGuard) ──────────────────────────────

  /**
   * validateApiKey
   * Compares raw key against stored bcrypt hash.
   * Returns the service account if valid and active.
   * Throws UnauthorizedException otherwise.
   */
  async validateApiKey(rawKey: string) {
    // We can\'t look up by hash, so we must scan active accounts
    // In practice, the name is passed alongside or the key embeds the ID:
    // Format: "<accountId>:<rawKey>" allows O(1) lookup.
    const colonIdx = rawKey.indexOf(':');
    if (colonIdx === -1) {
      throw new UnauthorizedException('Invalid API key format. Expected: <id>:<key>');
    }

    const accountId = rawKey.slice(0, colonIdx);
    const secret    = rawKey.slice(colonIdx + 1);

    const account = await this.prisma.serviceAccount.findUnique({ where: { id: accountId } });
    if (!account || account.revokedAt !== null) {
      throw new UnauthorizedException('Service account not found or revoked.');
    }

    const valid = await bcrypt.compare(secret, account.apiKeyHash);
    if (!valid) {
      throw new UnauthorizedException('Invalid API key.');
    }

    return account;
  }

  // ─── REVOKE ──────────────────────────────────────────────────────────────

  async revokeServiceAccount(id: string) {
    const account = await this.prisma.serviceAccount.findUnique({ where: { id } });
    if (!account) throw new NotFoundException(`ServiceAccount ${id} not found.`);
    if (account.revokedAt) throw new ConflictException('Service account is already revoked.');

    const updated = await this.prisma.serviceAccount.update({
      where: { id },
      data:  { revokedAt: new Date() },
    });
    this.logger.log(`ServiceAccount ${id} revoked.`);
    return updated;
  }

  // ─── LIST ──────────────────────────────────────────────────────────────

  async list() {
    return this.prisma.serviceAccount.findMany({
      orderBy: { createdAt: 'desc' },
      select:  { id: true, name: true, scope: true, createdAt: true, revokedAt: true },
      // Never return apiKeyHash
    });
  }
}
