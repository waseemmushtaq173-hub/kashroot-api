import {
  Injectable,
  Logger,
  NotFoundException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { EscrowStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from '../orders/ledger.service';

/**
 * EscrowService — multi-vertical escrow vault.
 *
 * Money lifecycle for an order/booking:
 *   1. holdPaymentForOrder()     PLACED/CONFIRMED  -> funds HELD in the vault
 *                                (buyer DEBIT ledger entry)
 *   2a. releaseEscrowToProvider() on completion    -> funds RELEASED to provider
 *                                (provider CREDIT ledger entry)
 *   2b. refundBuyer()            on dispute/cancel  -> funds REFUNDED to buyer
 *                                (buyer CREDIT ledger entry)
 *
 * Every movement is mirrored into the append-only ledger inside the SAME
 * transaction as the escrow state change, so the vault and the audit log can
 * never drift. HELD is the only state a hold can leave from — RELEASED and
 * REFUNDED are terminal, guaranteeing funds are disbursed exactly once.
 */
@Injectable()
export class EscrowService {
  private readonly logger = new Logger(EscrowService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Secure an order's funds in the virtual vault. Idempotency is enforced by the
   * unique orderId on escrow_holds: a second hold for the same order is rejected.
   */
  async holdPaymentForOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`);

    if (order.status !== 'PLACED' && order.status !== 'CONFIRMED') {
      throw new BadRequestException(
        `Cannot hold funds for an order in status ${order.status}. ` +
          `Escrow is secured for PLACED or CONFIRMED orders.`,
      );
    }

    const existing = await this.prisma.escrowHold.findUnique({ where: { orderId } });
    if (existing) {
      throw new ConflictException(
        `Escrow is already held for order ${orderId} (status: ${existing.status}).`,
      );
    }

    const amount = Number(order.total);

    const hold = await this.prisma.$transaction(async (tx) => {
      const created = await tx.escrowHold.create({
        data: {
          orderId,
          buyerProfileId: order.buyerProfileId,
          farmerProfileId: order.farmerProfileId,
          amount: order.total,
          currency: order.currency,
          status: EscrowStatus.HELD,
        },
      });

      // Buyer's money leaves their available balance into the vault.
      await this.ledger.createEntry(
        {
          farmerProfileId: null,
          buyerProfileId: order.buyerProfileId,
          entryType: 'DEBIT',
          amount,
          currency: order.currency,
          relatedOrderId: orderId,
          relatedRefundId: null,
          description: `Escrow HELD for order ${orderId}`,
        },
        tx,
      );

      return created;
    });

    this.logger.log(`Escrow HELD: order=${orderId} amount=${amount} ${order.currency}`);
    return hold;
  }

  /**
   * Release held funds to the provider/seller once the order is confirmed
   * complete. Only a HELD hold can be released, and only for a DELIVERED or
   * COMPLETED order — this is the single disbursement path to the provider.
   */
  async releaseEscrowToProvider(orderId: string) {
    const hold = await this.requireHold(orderId);

    if (hold.status !== EscrowStatus.HELD) {
      throw new ConflictException(
        `Cannot release order ${orderId}: escrow is ${hold.status}, not HELD.`,
      );
    }

    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`);
    if (order.status !== 'DELIVERED' && order.status !== 'COMPLETED') {
      throw new BadRequestException(
        `Cannot release escrow for order in status ${order.status}. ` +
          `Release requires a DELIVERED or COMPLETED order (completion confirmation).`,
      );
    }

    const amount = Number(hold.amount);

    const released = await this.prisma.$transaction(async (tx) => {
      // Guarded transition: only flip a row that is still HELD (defends against
      // a concurrent release/refund racing this one).
      const { count } = await tx.escrowHold.updateMany({
        where: { id: hold.id, status: EscrowStatus.HELD },
        data: { status: EscrowStatus.RELEASED, releasedAt: new Date() },
      });
      if (count === 0) {
        throw new ConflictException(`Escrow for order ${orderId} was already settled.`);
      }

      await this.ledger.createEntry(
        {
          farmerProfileId: hold.farmerProfileId,
          buyerProfileId: null,
          entryType: 'CREDIT',
          amount,
          currency: hold.currency,
          relatedOrderId: orderId,
          relatedRefundId: null,
          description: `Escrow RELEASED to provider for order ${orderId}`,
        },
        tx,
      );

      return tx.escrowHold.findUnique({ where: { id: hold.id } });
    });

    this.logger.log(`Escrow RELEASED: order=${orderId} amount=${amount} ${hold.currency}`);
    return released;
  }

  /**
   * Refund held funds to the buyer (automated dispute / cancellation outcome).
   * Only a HELD hold can be refunded; once RELEASED to the provider, recovery is
   * a separate reversal flow, never a silent state flip here.
   */
  async refundBuyer(orderId: string, opts: { refundId?: string; reason?: string } = {}) {
    const hold = await this.requireHold(orderId);

    if (hold.status !== EscrowStatus.HELD) {
      throw new ConflictException(
        `Cannot refund order ${orderId}: escrow is ${hold.status}, not HELD.`,
      );
    }

    const amount = Number(hold.amount);
    const refundId = opts.refundId ?? null;

    const refunded = await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.escrowHold.updateMany({
        where: { id: hold.id, status: EscrowStatus.HELD },
        data: { status: EscrowStatus.REFUNDED, refundedAt: new Date(), relatedRefundId: refundId },
      });
      if (count === 0) {
        throw new ConflictException(`Escrow for order ${orderId} was already settled.`);
      }

      await this.ledger.createEntry(
        {
          farmerProfileId: null,
          buyerProfileId: hold.buyerProfileId,
          entryType: 'CREDIT',
          amount,
          currency: hold.currency,
          relatedOrderId: orderId,
          relatedRefundId: refundId,
          description:
            `Escrow REFUNDED to buyer for order ${orderId}` +
            (opts.reason ? ` — ${opts.reason}` : ''),
        },
        tx,
      );

      return tx.escrowHold.findUnique({ where: { id: hold.id } });
    });

    this.logger.log(`Escrow REFUNDED: order=${orderId} amount=${amount} ${hold.currency}`);
    return refunded;
  }

  /** Read the hold + its chronological ledger trail for an order. */
  async getEscrowForOrder(orderId: string) {
    const hold = await this.requireHold(orderId);
    const ledger = await this.ledger.queryByOrder(orderId);
    return { hold, ledger };
  }

  private async requireHold(orderId: string) {
    const hold = await this.prisma.escrowHold.findUnique({ where: { orderId } });
    if (!hold) throw new NotFoundException(`No escrow hold found for order ${orderId}.`);
    return hold;
  }
}
