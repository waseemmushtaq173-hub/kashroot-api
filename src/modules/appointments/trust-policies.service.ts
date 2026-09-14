import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface TrustPolicy {
  id: string;
  regionId: string | null;
  firstTimePairRequiresAppointment: boolean;
  minOrderValueRequiringAppointment: number;  // 0 = never required by value
  noShowCountThresholdForReview: number;
  isActive: boolean;
  versionLabel: string | null;
  currency: string;
}

/**
 * TrustPoliciesService
 *
 * Reads trust policy config from the trust_policies table.
 * Values are NEVER hardcoded — they must be changeable without a code deploy.
 *
 * Resolution order (most specific wins):
 *   1. Active region-scoped policy matching the given regionId
 *   2. Active global policy (region_id IS NULL)
 *
 * Caching:
 *   Policies are cached in-memory for CACHE_TTL_MS (default 60 s) to avoid
 *   a DB round-trip on every appointment request. Cache is invalidated on
 *   module init and can be force-refreshed via refreshCache().
 *
 * Versioning:
 *   Each policy change creates a NEW row (is_active=true) and flips the
 *   previous row to is_active=false. Old rows are retained for audit.
 */
@Injectable()
export class TrustPoliciesService implements OnModuleInit {
  private readonly logger = new Logger(TrustPoliciesService.name);
  private static readonly CACHE_TTL_MS = 60_000; // 60 seconds

  // Simple in-memory cache: regionId (or '__global__') → { policy, cachedAt }
  private cache = new Map<string, { policy: TrustPolicy; cachedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Warm the global policy cache on startup
    try {
      await this.getEffectivePolicy(null);
      this.logger.log('Trust policy cache warmed on startup.');
    } catch (err) {
      this.logger.warn(
        `Could not warm trust policy cache on startup: ${(err as Error).message}`,
      );
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // POLICY RESOLUTION
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Return the effective trust policy for a given region.
   * Null regionId returns the global policy.
   * Resolution: region-scoped (if exists and active) > global.
   */
  async getEffectivePolicy(regionId: string | null): Promise<TrustPolicy> {
    const cacheKey = regionId ?? '__global__';
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.cachedAt < TrustPoliciesService.CACHE_TTL_MS) {
      return cached.policy;
    }

    let policy: TrustPolicy | null = null;

    // Try region-scoped policy first
    if (regionId) {
      policy = await this.fetchActivePolicy(regionId);
    }

    // Fall back to global policy
    if (!policy) {
      policy = await this.fetchActivePolicy(null);
    }

    if (!policy) {
      // Defensive fallback — should never happen after migration seeds a default
      this.logger.error(
        'No active trust policy found in DB. Using hardcoded safe defaults.',
      );
      policy = this.safeDefaults();
    }

    this.cache.set(cacheKey, { policy, cachedAt: Date.now() });
    return policy;
  }

  /**
   * Check whether a buyer/farmer pair requires an appointment before ordering.
   *
   * Rules (both are OR conditions — either triggers the requirement):
   *   1. firstTimePairRequiresAppointment = true AND this is their first order.
   *   2. orderValueAmount > minOrderValueRequiringAppointment (and that value > 0).
   */
  async isAppointmentRequiredForOrder(args: {
    farmerProfileId: string;
    buyerProfileId: string;
    orderValueAmount: number;
    regionId: string | null;
  }): Promise<{ required: boolean; reason?: string }> {
    const policy = await this.getEffectivePolicy(args.regionId);

    // Check high-value threshold
    if (
      policy.minOrderValueRequiringAppointment > 0 &&
      args.orderValueAmount > policy.minOrderValueRequiringAppointment
    ) {
      return {
        required: true,
        reason: `Order value exceeds policy threshold of ${policy.minOrderValueRequiringAppointment} ${policy.currency}`,
      };
    }

    // Check first-time pair requirement
    if (policy.firstTimePairRequiresAppointment) {
      const priorCompletedOrder = await this.prisma.order.findFirst({
        where: {
          farmerProfileId: args.farmerProfileId,
          buyerProfileId:  args.buyerProfileId,
          status: { in: ['COMPLETED', 'DELIVERED', 'DISPATCHED'] },
        },
        select: { id: true },
      });

      if (!priorCompletedOrder) {
        return {
          required: true,
          reason: 'First-time buyer/farmer pair requires a completed appointment before ordering',
        };
      }
    }

    return { required: false };
  }

  /**
   * Check no-show threshold and return whether the profile should be
   * flagged for regional-admin review.
   *
   * DOES NOT auto-suspend — only returns a boolean flag.
   * The caller (appointments.service.ts) writes the audit_log entry.
   */
  async isNoShowThresholdBreached(args: {
    noShowCount: number;
    regionId: string | null;
  }): Promise<boolean> {
    const policy = await this.getEffectivePolicy(args.regionId);
    return args.noShowCount >= policy.noShowCountThresholdForReview;
  }

  /**
   * Force-refresh the cache for a given region (or global).
   * Call this after an admin updates a trust policy.
   */
  async refreshCache(regionId: string | null = null): Promise<void> {
    this.cache.delete(regionId ?? '__global__');
    await this.getEffectivePolicy(regionId);
    this.logger.log(`Trust policy cache refreshed for region=${regionId ?? 'global'}.`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  private async fetchActivePolicy(regionId: string | null): Promise<TrustPolicy | null> {
    const row = await this.prisma.trustPolicy.findFirst({
      where: {
        isActive:  true,
        regionId:  regionId ?? null,
      },
      orderBy: { createdAt: 'desc' },
    });

    if (!row) return null;

    return {
      id:                                   row.id,
      regionId:                             row.regionId,
      firstTimePairRequiresAppointment:     row.firstTimePairRequiresAppointment,
      minOrderValueRequiringAppointment:    Number(row.minOrderValueRequiringAppointment),
      noShowCountThresholdForReview:        row.noShowCountThresholdForReview,
      isActive:                             row.isActive,
      versionLabel:                         row.versionLabel,
      currency:                             row.currency,
    };
  }

  private safeDefaults(): TrustPolicy {
    return {
      id:                                   'default',
      regionId:                             null,
      firstTimePairRequiresAppointment:     true,
      minOrderValueRequiringAppointment:    0,
      noShowCountThresholdForReview:        3,
      isActive:                             true,
      versionLabel:                         'fallback',
      currency:                             'INR',
    };
  }
}
