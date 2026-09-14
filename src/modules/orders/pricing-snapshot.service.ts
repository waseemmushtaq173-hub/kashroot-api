import { Injectable, Logger, InternalServerErrorException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export interface PricingInput {
  listingId:           string;
  quantity:            number;
  unitPrice:           number;
  currency:            string;
  isCrossBorder:       boolean;
  destinationRegionId: string | null;
}

export interface PricingResult {
  feeConfigVersionId:  string;
  unitPrice:           number;
  quantity:            number;
  subtotal:            number;
  serviceFeeRate:      number;
  serviceFeeAmount:    number;
  shippingEstimate:    number;
  customsDutyRate:     number;
  customsDutyEstimate: number;
  total:               number;
  currency:            string;
}

/**
 * PricingSnapshotService
 *
 * Responsibilities:
 *   1. Resolve the active fee_config_version for a given region (or global).
 *   2. Calculate the full pricing breakdown for an order.
 *   3. Write the order_pricing_snapshot row (write-once — never updated).
 *
 * Immutability contract:
 *   - The snapshot is written ONCE inside OrdersService.$transaction.
 *   - This service has NO update or delete method.
 *   - Historical order totals are immutable. Later fee changes apply only
 *     to new orders via a new fee_config_version row.
 */
@Injectable()
export class PricingSnapshotService {
  private readonly logger = new Logger(PricingSnapshotService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // CALCULATE (read-only, no writes)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Calculate pricing for an order using the currently active fee version.
   * Does NOT write anything. Call writeSnapshot() to persist.
   */
  async calculate(input: PricingInput): Promise<PricingResult> {
    const feeVersion = await this.resolveActiveFeeVersion(input.destinationRegionId);

    const subtotal            = round4(input.unitPrice * input.quantity);
    const serviceFeeRate      = Number(feeVersion.serviceFeeRate);
    const serviceFeeAmount    = round4(subtotal * serviceFeeRate);
    const shippingEstimate    = round4(Number(feeVersion.shippingBaseAmount));
    const customsDutyRate     = input.isCrossBorder ? Number(feeVersion.customsDutyRate) : 0;
    const customsDutyEstimate = input.isCrossBorder ? round4(subtotal * customsDutyRate) : 0;
    const total               = round4(subtotal + serviceFeeAmount + shippingEstimate + customsDutyEstimate);

    return {
      feeConfigVersionId:  feeVersion.id,
      unitPrice:           input.unitPrice,
      quantity:            input.quantity,
      subtotal,
      serviceFeeRate,
      serviceFeeAmount,
      shippingEstimate,
      customsDutyRate,
      customsDutyEstimate,
      total,
      currency:            input.currency,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WRITE SNAPSHOT (called inside OrdersService.$transaction)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Write the pricing snapshot row inside an existing Prisma transaction.
   * This is write-once. There is intentionally no updateSnapshot() method.
   *
   * @param tx     - Prisma transaction client (passed from OrdersService.$transaction)
   * @param orderId - The newly created order's UUID
   * @param pricing - The result of calculate()
   */
  async writeSnapshot(
    tx:      Prisma.TransactionClient,
    orderId: string,
    pricing: PricingResult,
  ): Promise<void> {
    await tx.orderPricingSnapshot.create({
      data: {
        orderId,
        feeConfigVersionId:  pricing.feeConfigVersionId,
        unitPrice:           pricing.unitPrice,
        quantity:            pricing.quantity,
        subtotal:            pricing.subtotal,
        serviceFeeRate:      pricing.serviceFeeRate,
        serviceFeeAmount:    pricing.serviceFeeAmount,
        shippingEstimate:    pricing.shippingEstimate,
        customsDutyRate:     pricing.customsDutyRate,
        customsDutyEstimate: pricing.customsDutyEstimate,
        total:               pricing.total,
        currency:            pricing.currency,
      },
    });

    this.logger.log(
      `Pricing snapshot written for order ${orderId}: ` +
      `total=${pricing.total} ${pricing.currency}, ` +
      `feeVersion=${pricing.feeConfigVersionId}`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE
  // ─────────────────────────────────────────────────────────────────────────

  private async resolveActiveFeeVersion(regionId: string | null) {
    // Try region-scoped version first, fall back to global
    let version = regionId
      ? await this.prisma.feeConfigVersion.findFirst({
          where: { isCurrent: true, regionId },
          orderBy: { effectiveFrom: 'desc' },
        })
      : null;

    if (!version) {
      version = await this.prisma.feeConfigVersion.findFirst({
        where: { isCurrent: true, regionId: null },
        orderBy: { effectiveFrom: 'desc' },
      });
    }

    if (!version) {
      throw new InternalServerErrorException(
        'No active fee_config_version found. Cannot price order.',
      );
    }

    return version;
  }
}

// Rounds to 4 decimal places (matches NUMERIC(14,4) in DB)
function round4(n: number): number {
  return Math.round(n * 10_000) / 10_000;
}
