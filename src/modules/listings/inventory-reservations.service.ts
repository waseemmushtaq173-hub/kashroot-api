import {
  Injectable,
  NotFoundException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';

export const RESERVATION_EXPIRY_QUEUE = 'reservation-expiry';

export interface CreateReservationResult {
  reservationId: string;
  listingId: string;
  qty: number;
  expiresAt: Date;
  availableQtyAfter: number;
}

/**
 * InventoryReservationsService
 *
 * Lifecycle:
 *   1. Buyer starts checkout → createReservation() atomically increments
 *      listings.reserved_qty and creates an inventory_reservation row.
 *   2. A BullMQ delayed job (delay = expiry window) is enqueued immediately
 *      after the DB write to auto-release if checkout is abandoned.
 *   3a. Order committed   → commitReservation() permanently deducts
 *       available_qty, decrements reserved_qty, cancels the BullMQ job.
 *   3b. Checkout abandoned / job fires → releaseReservation() returns qty
 *       to listings (decrements reserved_qty), marks reservation EXPIRED.
 *
 * ATOMICITY GUARANTEE:
 *   Stock deduction uses SELECT ... FOR UPDATE inside a Serializable
 *   transaction. Two concurrent checkouts on the same listing can never
 *   both succeed if combined qty exceeds effective stock.
 */
@Injectable()
export class InventoryReservationsService {
  private readonly logger = new Logger(InventoryReservationsService.name);
  private readonly expiryWindowMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    @InjectQueue(RESERVATION_EXPIRY_QUEUE)
    private readonly expiryQueue: Queue,
  ) {
    const minutes = this.config.get<number>('RESERVATION_EXPIRY_MINUTES', 15);
    this.expiryWindowMs = minutes * 60 * 1000;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE RESERVATION  (called when buyer starts checkout)
  // ─────────────────────────────────────────────────────────────────────────

  async createReservation(
    listingId: string,
    buyerProfileId: string,
    qty: number,
    orderId?: string,
  ): Promise<CreateReservationResult> {
    const expiresAt = new Date(Date.now() + this.expiryWindowMs);

    const { created, effectiveStockAfter } = await this.prisma.$transaction(
      async (tx) => {
        // Row-level lock — prevents concurrent oversell
        const listing = await tx.$queryRaw<
          Array<{ id: string; available_qty: number; reserved_qty: number; status: string }>
        >`
          SELECT id, available_qty, reserved_qty, status
          FROM listings
          WHERE id = ${listingId}
          FOR UPDATE
        `;

        if (!listing.length) throw new NotFoundException(`Listing ${listingId} not found`);
        const row = listing[0];

        if (row.status !== 'ACTIVE') {
          throw new ConflictException(
            `Listing not available for purchase (status: ${row.status}).`,
          );
        }

        const effectiveStock = row.available_qty - row.reserved_qty;
        if (effectiveStock < qty) {
          throw new ConflictException(
            `Insufficient stock. Requested: ${qty}, available: ${effectiveStock}.`,
          );
        }

        // Hold the qty atomically
        await tx.$executeRaw`
          UPDATE listings
          SET    reserved_qty = reserved_qty + ${qty},
                 updated_at   = now()
          WHERE  id = ${listingId}
        `;

        const created = await tx.inventoryReservation.create({
          data: {
            listingId,
            buyerProfileId,
            orderId:    orderId ?? null,
            qty,
            expiresAt,
            status:     'RESERVED',
            releasedAt: null,
          },
        });

        return { created, effectiveStockAfter: effectiveStock - qty };
      },
      { isolationLevel: 'Serializable' },
    );

    // ── Enqueue BullMQ delayed job ────────────────────────────────────────
    // Job fires after expiryWindowMs and calls releaseReservation().
    // jobId is deterministic so duplicate enqueues are deduplicated by Redis.
    await this.expiryQueue.add(
      'expire-reservation',
      { reservationId: created.id, listingId, qty },
      {
        delay:            this.expiryWindowMs,
        jobId:            `reservation-expiry:${created.id}`,
        attempts:         3,
        backoff:          { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail:     false,
      },
    );

    this.logger.log(
      `[Reservation ${created.id}] created for listing ${listingId} ` +
      `qty=${qty}, expires=${expiresAt.toISOString()}`,
    );

    return {
      reservationId:     created.id,
      listingId,
      qty,
      expiresAt,
      availableQtyAfter: effectiveStockAfter,
    };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RELEASE RESERVATION  (BullMQ sweeper OR explicit cancel)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Release a reservation — idempotent.
   * Only acts if status is still 'RESERVED'; skips silently otherwise.
   * Sets status = 'EXPIRED' and returns qty to listing atomically.
   */
  async releaseReservation(
    reservationId: string,
    reason: 'expired' | 'cancelled' = 'expired',
  ): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        // Re-check status inside the transaction (idempotency guard)
        const reservation = await tx.inventoryReservation.findUnique({
          where: { id: reservationId },
        });

        if (!reservation) {
          this.logger.warn(
            `[Reservation ${reservationId}] not found — skip release (idempotent)`,
          );
          return;
        }

        if (reservation.status !== 'RESERVED') {
          this.logger.debug(
            `[Reservation ${reservationId}] already ${reservation.status} — skip release`,
          );
          return;
        }

        // Return qty to listing atomically (GREATEST guards against negative drift)
        await tx.$executeRaw`
          UPDATE listings
          SET    reserved_qty = GREATEST(0, reserved_qty - ${reservation.qty}),
                 updated_at   = now()
          WHERE  id = ${reservation.listingId}
        `;

        const newStatus = reason === 'expired' ? 'EXPIRED' : 'CANCELLED';
        await tx.inventoryReservation.update({
          where: { id: reservationId },
          data:  { status: newStatus, releasedAt: new Date() },
        });

        // Audit log entry — tracked for trust/no-show metrics
        await tx.auditLog.create({
          data: {
            actorUserId: reservation.buyerProfileId, // buyer who abandoned
            action:      `reservation:${newStatus.toLowerCase()}`,
            targetType:  'inventory_reservation',
            targetId:    reservationId,
            metadata: {
              listingId:     reservation.listingId,
              qty:           reservation.qty,
              orderId:       reservation.orderId,
              expiresAt:     reservation.expiresAt.toISOString(),
              releasedAt:    new Date().toISOString(),
              reason,
            },
          },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );

    this.logger.log(
      `[Reservation ${reservationId}] released (reason=${reason}) — stock returned.`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMMIT RESERVATION  (order confirmed + payment captured)
  // ─────────────────────────────────────────────────────────────────────────

  async commitReservation(reservationId: string): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        const reservation = await tx.inventoryReservation.findUnique({
          where: { id: reservationId },
        });

        if (!reservation) throw new NotFoundException(`Reservation ${reservationId} not found.`);
        if (reservation.status !== 'RESERVED') {
          throw new ConflictException(
            `Reservation ${reservationId} is already ${reservation.status} — cannot commit.`,
          );
        }

        // Permanently deduct stock + release hold in one UPDATE
        await tx.$executeRaw`
          UPDATE listings
          SET    available_qty = GREATEST(0, available_qty - ${reservation.qty}),
                 reserved_qty  = GREATEST(0, reserved_qty  - ${reservation.qty}),
                 updated_at    = now()
          WHERE  id = ${reservation.listingId}
        `;

        await tx.inventoryReservation.update({
          where: { id: reservationId },
          data:  { status: 'COMMITTED', releasedAt: new Date(), committedAt: new Date() },
        });
      },
      { isolationLevel: 'ReadCommitted' },
    );

    // Cancel the BullMQ expiry job — best-effort (job may have already run)
    try {
      const job = await this.expiryQueue.getJob(`reservation-expiry:${reservationId}`);
      if (job) await job.remove();
    } catch (err) {
      this.logger.warn(
        `[Reservation ${reservationId}] could not remove expiry job: ${(err as Error).message}`,
      );
    }

    this.logger.log(`[Reservation ${reservationId}] committed — stock permanently deducted.`);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // QUERY HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  async getActiveReservations(listingId: string) {
    return this.prisma.inventoryReservation.findMany({
      where: { listingId, status: 'RESERVED', expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getReservationsByBuyer(buyerProfileId: string) {
    return this.prisma.inventoryReservation.findMany({
      where:   { buyerProfileId },
      orderBy: { createdAt: 'desc' },
      include: { listing: { select: { id: true, title: true, status: true } } },
    });
  }
}
