import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AppointmentsService } from '../appointments/appointments.service';
import { TrustPoliciesService } from '../appointments/trust-policies.service';
import { InventoryReservationsService } from '../listings/inventory-reservations.service';
import { RegionPairEnablementService } from './region-pair-enablement.service';
import { PricingSnapshotService } from './pricing-snapshot.service';
import { TradeDirectionService, TradeDirection } from './trade-direction.service';
import { LedgerService } from './ledger.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderStatusDto, ORDER_STATUS_TRANSITIONS, OrderStatus } from './dto/update-order-status.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/dto/notification.dto';

/**
 * OrdersService
 *
 * Creation flow (all inside one Prisma $transaction):
 *   1. Trust-gate check  — AppointmentsService.isAppointmentCompleted() (NOT isConfirmed)
 *   2. Region-pair gate  — RegionPairEnablementService.assertRouteEnabled() (hard reject)
 *   3. Reservation commit— InventoryReservationsService.commitReservation() (reuses Module 2)
 *   4. Pricing snapshot  — PricingSnapshotService.calculate() + writeSnapshot()
 *   5. Order row insert  — with origin_region_id + destination_region_id snapshotted
 *
 * Ownership:
 *   All profile lookups go through farmer_profiles.user_id / buyer_profiles.user_id.
 *   Never use a raw profile id shortcut.
 *
 * Trade direction:
 *   NOT stored on the order. Use TradeDirectionService.getTradeDirection(order, perspectiveRegionId).
 *   is_cross_border is a separate boolean derived from country codes at creation.
 */
@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma:                 PrismaService,
    private readonly appointmentsService:    AppointmentsService,
    private readonly trustPolicies:          TrustPoliciesService,
    private readonly inventoryReservations:  InventoryReservationsService,
    private readonly regionPairEnablement:   RegionPairEnablementService,
    private readonly pricingSnapshot:        PricingSnapshotService,
    private readonly tradeDirection:         TradeDirectionService,
    private readonly ledger:                 LedgerService,
    private readonly notifications:          NotificationsService,
  ) {}

  // ───────────────────────────────────────────────────────────────
  // CREATE
  // ───────────────────────────────────────────────────────────────

  async create(buyerUserId: string, dto: CreateOrderDto) {
    // ─── 0. Resolve profiles via user_id (never raw id) ──────────────────────────────
    const buyerProfile = await this.prisma.buyerProfile.findUnique({
      where: { userId: buyerUserId },
    });
    if (!buyerProfile) throw new NotFoundException('Buyer profile not found.');

    const listing = await this.prisma.listing.findUnique({
      where: { id: dto.listingId },
      include: { farmerProfile: true },
    });
    if (!listing || listing.status !== 'ACTIVE') {
      throw new NotFoundException('Listing not found or not active.');
    }

    const farmerProfile = listing.farmerProfile;

    // Snapshot origin region from the listing now — listing.originRegionId may change later
    const originRegionId      = listing.originRegionId;
    const destinationRegionId = dto.destinationRegionId;

    // ─── 1. Trust-gate check ────────────────────────────────────────────────
    // Calculate pricing first so we can pass order value to trust policy check
    const isCrossBorder = this.tradeDirection.isCrossBorder(
      originRegionId,
      destinationRegionId,
    );
    const pricing = await this.pricingSnapshot.calculate({
      listingId:           dto.listingId,
      quantity:            dto.quantity,
      unitPrice:           Number(listing.pricePerUnit),
      currency:            listing.currency,
      isCrossBorder,
      destinationRegionId,
    });

    const trustRequired = await this.trustPolicies.requiresAppointment(
      farmerProfile.id,
      buyerProfile.id,
      pricing.total,
    );

    if (trustRequired) {
      // isAppointmentCompleted — NEVER isAppointmentConfirmed
      const completed = await this.appointmentsService.isAppointmentCompleted(
        farmerProfile.id,
        buyerProfile.id,
      );
      if (!completed) {
        throw new ForbiddenException(
          'A completed appointment is required before placing this order. ' +
          'Please schedule and complete an appointment with this farmer first.',
        );
      }
    }

    // ─── 2. Region-pair gate (hard reject) ────────────────────────────────────
    await this.regionPairEnablement.assertRouteEnabled(originRegionId, destinationRegionId);

    // ─── 3 + 4 + 5. All writes in a single $transaction ─────────────────────────────
    const order = await this.prisma.$transaction(async (tx) => {
      // 3. Commit inventory reservation (Module 2 pipeline — no separate stock decrement)
      if (dto.inventoryReservationId) {
        await this.inventoryReservations.commitReservation(
          dto.inventoryReservationId,
          buyerProfile.id,
          tx,
        );
      } else {
        // Fallback: direct stock check + decrement if no reservation was held
        const updatedListing = await tx.listing.update({
          where: { id: dto.listingId },
          data:  { stockQuantity: { decrement: dto.quantity } },
        });
        if (updatedListing.stockQuantity < 0) {
          throw new BadRequestException('Insufficient stock for this listing.');
        }
      }

      // 4. Write pricing snapshot (write-once — PricingSnapshotService has no update method)
      const newOrder = await tx.order.create({
        data: {
          farmerProfileId:     farmerProfile.id,
          buyerProfileId:      buyerProfile.id,
          listingId:           dto.listingId,
          quantity:            dto.quantity,
          status:              OrderStatus.PLACED,
          originRegionId,       // snapshotted from listing at creation
          destinationRegionId,  // snapshotted from DTO at creation
          isCrossBorder,        // derived from country codes, separate from trade_direction
          currency:            listing.currency,
          notes:               dto.notes ?? null,
        },
      });

      // 5. Write pricing snapshot (immutable, write-once)
      await this.pricingSnapshot.writeSnapshot(tx, newOrder.id, pricing);

      // 6. Write initial ledger entry — PLACED (pending collection)
      await this.ledger.appendEntry(tx, {
        buyerProfileId:  buyerProfile.id,
        farmerProfileId: null,
        entryType:       'DEBIT',
        amount:          pricing.total,
        currency:        pricing.currency,
        relatedOrderId:  newOrder.id,
        relatedRefundId: null,
        description:     `Order PLACED: ${newOrder.id}`,
      });

      return newOrder;
    });

    this.logger.log(
      `Order created: ${order.id} | farmer=${farmerProfile.id} buyer=${buyerProfile.id} ` +
      `route=${originRegionId}→${destinationRegionId} crossBorder=${isCrossBorder} total=${pricing.total}`,
    );

    return this.loadOrder(order.id);
  }

  // ───────────────────────────────────────────────────────────────
  // UPDATE STATUS
  // ───────────────────────────────────────────────────────────────

  async updateStatus(
    orderId:     string,
    actorUserId: string,
    dto:         UpdateOrderStatusDto,
  ) {
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`);

    // Validate transition
    const allowed = ORDER_STATUS_TRANSITIONS[order.status as OrderStatus];
    if (!allowed.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot transition order from ${order.status} to ${dto.status}. ` +
        `Allowed: ${allowed.join(', ') || 'none (terminal state)'}`,
      );
    }

    // CUSTOMS_CLEARANCE only valid for cross-border orders
    if (dto.status === OrderStatus.CUSTOMS_CLEARANCE && !order.isCrossBorder) {
      throw new BadRequestException(
        'CUSTOMS_CLEARANCE status is only applicable to cross-border orders.',
      );
    }

    const updated = await this.prisma.order.update({
      where: { id: orderId },
      data:  { status: dto.status },
    });

    this.logger.log(`Order ${orderId} transitioned: ${order.status} → ${dto.status} by user ${actorUserId}`);

    // ── Notify both farmer and buyer of status change ──────────────────────
    const fullOrder = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { farmerProfile: { select: { userId: true } }, buyerProfile: { select: { userId: true } } },
    });
    const notifPayload = { orderId, oldStatus: order.status, newStatus: dto.status };
    const notifKey = `ORDER_STATUS_CHANGED:${orderId}:${dto.status}`;
    const recipientIds = [
      fullOrder?.farmerProfile?.userId,
      fullOrder?.buyerProfile?.userId,
    ].filter(Boolean) as string[];
    await Promise.all(
      recipientIds.map((uid) =>
        this.notifications.enqueueAll(uid, NotificationCategory.ORDER_STATUS_CHANGED, notifPayload, `${notifKey}:${uid}`),
      ),
    );

    return updated;
  }

  // ───────────────────────────────────────────────────────────────
  // LOAD
  // ───────────────────────────────────────────────────────────────

  async loadOrder(orderId: string) {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        pricingSnapshot: true,
        payments:        true,
        refunds:         true,
        customsDocs:     true,
      },
    });
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`);
    return order;
  }

  async listByBuyer(buyerUserId: string) {
    const buyerProfile = await this.prisma.buyerProfile.findUnique({ where: { userId: buyerUserId } });
    if (!buyerProfile) throw new NotFoundException('Buyer profile not found.');
    return this.prisma.order.findMany({
      where:   { buyerProfileId: buyerProfile.id },
      include: { pricingSnapshot: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listByFarmer(farmerUserId: string) {
    const farmerProfile = await this.prisma.farmerProfile.findUnique({ where: { userId: farmerUserId } });
    if (!farmerProfile) throw new NotFoundException('Farmer profile not found.');
    return this.prisma.order.findMany({
      where:   { farmerProfileId: farmerProfile.id },
      include: { pricingSnapshot: true },
      orderBy: { createdAt: 'desc' },
    });
  }
}
