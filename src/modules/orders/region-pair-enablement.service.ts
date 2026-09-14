import { Injectable, ForbiddenException, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface RegionPairStatus {
  originRegionId:            string;
  destinationRegionId:       string;
  paymentProviderVerified:   boolean;
  customsComplianceVerified: boolean;
  shippingPartnerVerified:   boolean;
  enabled:                   boolean;
  notes:                     string | null;
}

/**
 * RegionPairEnablementService
 *
 * HARD GATE: order creation is rejected unless the
 * (origin_region_id, destination_region_id) pair has enabled=true.
 *
 * "Hard gate" means:
 *   - No row in the table  → REJECT (absence = disabled by design)
 *   - Row exists but enabled=false → REJECT
 *   - Row exists and enabled=true  → ALLOW
 *
 * This is NOT a soft warning. The service throws ForbiddenException
 * regardless of whether a payment provider is integrated in code.
 *
 * Cache: pairs cached for CACHE_TTL_MS (default 5 min) to avoid per-request
 * DB hits. Routes change infrequently; cache is acceptable here.
 * Call refreshCache() after an admin enables a new route.
 */
@Injectable()
export class RegionPairEnablementService implements OnModuleInit {
  private readonly logger  = new Logger(RegionPairEnablementService.name);
  private static readonly CACHE_TTL_MS = 5 * 60 * 1_000; // 5 minutes

  // key = `${originId}:${destinationId}`
  private cache = new Map<string, { pair: RegionPairStatus | null; cachedAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    this.logger.log('RegionPairEnablementService initialised (cache cold — warmed on first request).');
  }

  // ─── PUBLIC API ───────────────────────────────────────────────────────────────

  /**
   * assertRouteEnabled
   *
   * Throws ForbiddenException if the route is not enabled.
   * Called at the top of OrdersService.create() before any writes.
   *
   * @param originRegionId      — snapshotted from the listing at order creation
   * @param destinationRegionId — from the buyer's destinationRegionId in CreateOrderDto
   */
  async assertRouteEnabled(
    originRegionId:      string,
    destinationRegionId: string,
  ): Promise<void> {
    const pair = await this.getPair(originRegionId, destinationRegionId);

    if (!pair || !pair.enabled) {
      const reason = !pair
        ? 'no trade route configured for this origin → destination pair'
        : `route is currently disabled (paymentVerified=${pair.paymentProviderVerified}, customsVerified=${pair.customsComplianceVerified}, shippingVerified=${pair.shippingPartnerVerified})`;

      this.logger.warn(
        `Route rejected: ${originRegionId} → ${destinationRegionId} | ${reason}`,
      );

      throw new ForbiddenException(
        `Orders cannot be placed on this trade route: ${reason}. ` +
        `Contact support if you believe this route should be enabled.`,
      );
    }
  }

  /**
   * getPair — returns the pair config, or null if not found.
   * Results are cached.
   */
  async getPair(
    originRegionId:      string,
    destinationRegionId: string,
  ): Promise<RegionPairStatus | null> {
    const key    = `${originRegionId}:${destinationRegionId}`;
    const cached = this.cache.get(key);

    if (cached && Date.now() - cached.cachedAt < RegionPairEnablementService.CACHE_TTL_MS) {
      return cached.pair;
    }

    const row = await this.prisma.regionPairEnablement.findUnique({
      where: {
        originRegionId_destinationRegionId: { originRegionId, destinationRegionId },
      },
    });

    const pair: RegionPairStatus | null = row
      ? {
          originRegionId:            row.originRegionId,
          destinationRegionId:       row.destinationRegionId,
          paymentProviderVerified:   row.paymentProviderVerified,
          customsComplianceVerified: row.customsComplianceVerified,
          shippingPartnerVerified:   row.shippingPartnerVerified,
          enabled:                   row.enabled,
          notes:                     row.notes,
        }
      : null;

    this.cache.set(key, { pair, cachedAt: Date.now() });
    return pair;
  }

  /** Force-refresh cache for a specific pair (call after admin enables/disables a route). */
  async refreshCache(originRegionId: string, destinationRegionId: string): Promise<void> {
    const key = `${originRegionId}:${destinationRegionId}`;
    this.cache.delete(key);
    await this.getPair(originRegionId, destinationRegionId);
    this.logger.log(`Cache refreshed for route ${originRegionId} → ${destinationRegionId}`);
  }

  /** Clear the entire cache (e.g. after bulk admin update). */
  clearAllCache(): void {
    this.cache.clear();
    this.logger.log('Region pair enablement cache fully cleared.');
  }
}
