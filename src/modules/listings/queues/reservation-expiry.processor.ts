import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import {
  InventoryReservationsService,
  RESERVATION_EXPIRY_QUEUE,
} from '../inventory-reservations.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationCategory } from '../../notifications/dto/notification.dto';
import { PrismaService } from '../../../prisma/prisma.service';

export interface ReservationExpiryJobData {
  reservationId: string;
  listingId: string;
  qty: number;
}

/**
 * ReservationExpiryProcessor
 *
 * Listens on the 'reservation-expiry' BullMQ queue.
 * A delayed job is enqueued by InventoryReservationsService.createReservation()
 * with delay = RESERVATION_EXPIRY_MINUTES (default 15 min).
 *
 * On firing:
 *   1. Calls releaseReservation(reservationId, 'expired').
 *   2. releaseReservation() re-checks status === 'RESERVED' inside its own
 *      transaction — idempotent if the job fires twice or fires late.
 *   3. On actual release: writes an audit_log entry (tracked for
 *      trust / no-show metrics) and returns qty to listing.reserved_qty.
 *
 * Retry policy (configured on the queue in ListingsModule):
 *   - 3 attempts with exponential backoff starting at 5 s.
 *   - removeOnComplete: true  (successful jobs cleaned up automatically)
 *   - removeOnFail:     false (failed jobs kept for inspection)
 */
@Processor(RESERVATION_EXPIRY_QUEUE)
export class ReservationExpiryProcessor extends WorkerHost {
  private readonly logger = new Logger(ReservationExpiryProcessor.name);

  constructor(
    private readonly inventoryReservationsService: InventoryReservationsService,
    private readonly notifications: NotificationsService,
    private readonly prisma: PrismaService,
  ) {
    super();
  }

  async process(job: Job<ReservationExpiryJobData>): Promise<void> {
    const { reservationId, listingId, qty } = job.data;

    this.logger.log(
      `[Job ${job.id}] expire-reservation fired — ` +
      `reservationId=${reservationId}, listingId=${listingId}, qty=${qty}`,
    );

    try {
      /**
       * releaseReservation() is fully idempotent:
       *   - Re-reads reservation.status inside a transaction.
       *   - If status !== 'RESERVED' (already COMMITTED, EXPIRED, CANCELLED)
       *     it logs and returns without touching stock.
       *   - If status === 'RESERVED', it atomically:
       *       • decrements listings.reserved_qty
       *       • sets reservation.status = 'EXPIRED'
       *       • writes an audit_log entry for no-show metrics
       */
      await this.inventoryReservationsService.releaseReservation(
        reservationId,
        'expired',
      );

      this.logger.log(
        `[Job ${job.id}] Reservation ${reservationId} expiry handled successfully.`,
      );

      // ── Notify the buyer that their reservation has expired ────────────────
      // Look up buyer's userId via the reservation's buyerProfileId
      const reservation = await this.prisma.inventoryReservation.findUnique({
        where:  { id: reservationId },
        select: { buyerProfileId: true, listingId: true },
      });
      if (reservation) {
        const buyerProfile = await this.prisma.buyerProfile.findUnique({
          where:  { id: reservation.buyerProfileId },
          select: { userId: true },
        });
        if (buyerProfile?.userId) {
          await this.notifications.enqueueAll(
            buyerProfile.userId,
            NotificationCategory.RESERVATION_EXPIRED,
            { reservationId, listingId: reservation.listingId },
            `RESERVATION_EXPIRED:${reservationId}`,
          );
        }
      }

    } catch (err) {
      // Let BullMQ retry according to the queue's backoff config.
      this.logger.error(
        `[Job ${job.id}] Failed to expire reservation ${reservationId}: ` +
          (err as Error).message,
        (err as Error).stack,
      );
      throw err; // re-throw so BullMQ marks the job as failed and retries
    }
  }
}
