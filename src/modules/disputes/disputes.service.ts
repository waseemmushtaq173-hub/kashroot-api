import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PaymentsService } from '../orders/payments.service';
import { LedgerService } from '../orders/ledger.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { RecommendDisputeDto, ResolveDisputeDto, DisputeResolutionAction } from './dto/resolve-dispute.dto';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/dto/notification.dto';

/**
 * DisputesService
 *
 * Regional authority model:
 *   - operational_region_id = order.origin_region_id (farmer\'s region = primary resolver).
 *     Snapshotted at dispute creation time.
 *   - Operational-region REGIONAL_ADMIN (dispute:resolve:regional) or PLATFORM_ADMIN
 *     (dispute:resolve:global) can execute resolution.
 *   - Cross-border orders: destination-region admin gets read + dispute:recommend only.
 *     They share the same access level as SUPPORT_MODERATOR for disputes.
 *     They CANNOT resolve or trigger refunds unilaterally.
 *   - SUPPORT_MODERATOR: recommend only (cannot resolve).
 *
 * Refund on resolution:
 *   Goes through Module 4 refunds table (PaymentsService / refunds row).
 *   No ad hoc refund mechanism here.
 *
 * Access check pattern for resolve:
 *   1. Actor must have dispute:resolve:regional OR dispute:resolve:global permission.
 *   2. If dispute:resolve:regional only: actor\'s regionId must match dispute.operational_region_id.
 *   3. If dispute:resolve:global: no region check (PLATFORM_ADMIN).
 */
@Injectable()
export class DisputesService {
  private readonly logger = new Logger(DisputesService.name);

  constructor(
    private readonly prisma:          PrismaService,
    private readonly paymentsService: PaymentsService,
    private readonly ledger:          LedgerService,
    private readonly notifications:   NotificationsService,
  ) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────

  async create(initiatedByUserId: string, dto: CreateDisputeDto) {
    const order = await this.prisma.order.findUnique({ where: { id: dto.orderId } });
    if (!order) throw new NotFoundException(`Order ${dto.orderId} not found.`);

    // Validate related chat thread is scoped to this order (if provided)
    if (dto.relatedChatThreadId) {
      const thread = await this.prisma.chatThread.findUnique({ where: { id: dto.relatedChatThreadId } });
      if (!thread || thread.orderId !== dto.orderId) {
        throw new BadRequestException('Related chat thread must be scoped to the same order.');
      }
    }

    // Snapshot operational_region and destination_region from order at creation time
    const dispute = await this.prisma.dispute.create({
      data: {
        orderId:              dto.orderId,
        operationalRegionId:  order.originRegionId,      // farmer\'s region = primary resolver
        destinationRegionId:  order.isCrossBorder ? order.destinationRegionId : null,
        isCrossBorder:        order.isCrossBorder,
        initiatedByUserId,
        type:                 dto.type,
        title:                dto.title,
        description:          dto.description,
        relatedChatThreadId:  dto.relatedChatThreadId ?? null,
        status:               'OPEN',
      },
    });

    this.logger.log(
      `Dispute ${dispute.id} created | order=${dto.orderId} ` +
      `operationalRegion=${dispute.operationalRegionId} crossBorder=${order.isCrossBorder}`,
    );

    // ── Notify both parties that dispute was opened ─────────────────────────
    const disputeOrder = await this.prisma.order.findUnique({
      where:  { id: dto.orderId },
      select: { farmerProfile: { select: { userId: true } }, buyerProfile: { select: { userId: true } } },
    });
    const disputePayload = { disputeId: dispute.id, orderId: dto.orderId, type: dto.type };
    for (const uid of [disputeOrder?.farmerProfile?.userId, disputeOrder?.buyerProfile?.userId].filter(Boolean) as string[]) {
      await this.notifications.enqueueAll(uid, NotificationCategory.DISPUTE_OPENED, disputePayload, `DISPUTE_OPENED:${dispute.id}:${uid}`);
    }

    return dispute;
  }

  // ─── RECOMMEND (SUPPORT_MODERATOR or destination-region admin on cross-border) ──────────

  /**
   * recommend
   * Allowed: SUPPORT_MODERATOR OR destination-region REGIONAL_ADMIN (cross-border only).
   * Moves status to RECOMMENDED. Does NOT resolve.
   * The calling controller layer is responsible for enforcing the role + region check
   * before calling this method.
   */
  async recommend(disputeId: string, actorUserId: string, dto: RecommendDisputeDto) {
    const dispute = await this.loadDispute(disputeId);
    this.assertNotTerminal(dispute.status);

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data:  {
        status:             'RECOMMENDED',
        resolutionSummary:  dto.recommendationSummary,
      },
    });

    this.logger.log(`Dispute ${disputeId} RECOMMENDED by user ${actorUserId}`);
    return updated;
  }

  // ─── RESOLVE (operational-region REGIONAL_ADMIN or PLATFORM_ADMIN only) ────────────

  /**
   * resolve
   *
   * @param actorUserId     - User executing the resolution
   * @param actorRegionId   - The region this actor is admin of (null = PLATFORM_ADMIN / global)
   * @param actorIsGlobal   - true if actor has dispute:resolve:global (PLATFORM_ADMIN)
   *
   * Region authority check (enforced here, not only at controller):
   *   - Global resolver: no region check
   *   - Regional resolver: actorRegionId must match dispute.operationalRegionId
   *   - Destination-region admin on cross-border: CANNOT resolve (ForbiddenException)
   */
  async resolve(
    disputeId:    string,
    actorUserId:  string,
    actorRegionId: string | null,
    actorIsGlobal: boolean,
    dto: ResolveDisputeDto,
  ) {
    const dispute = await this.loadDispute(disputeId);
    this.assertNotTerminal(dispute.status);

    // ─ Regional authority check ───────────────────────────────────────────
    if (!actorIsGlobal) {
      if (!actorRegionId) {
        throw new ForbiddenException('No region assigned. Cannot resolve disputes without regional authority.');
      }
      if (actorRegionId !== dispute.operationalRegionId) {
        throw new ForbiddenException(
          `Dispute ${disputeId} is owned by region ${dispute.operationalRegionId}. ` +
          `Your region (${actorRegionId}) does not have resolve authority. ` +
          `You may only submit a recommendation (dispute:recommend).`,
        );
      }
    }

    // ─ Validate refund params ───────────────────────────────────────────
    if (dto.action === DisputeResolutionAction.APPROVE_REFUND) {
      if (!dto.refundAmount || !dto.refundPaymentId) {
        throw new BadRequestException(
          'refundAmount and refundPaymentId are required when action = APPROVE_REFUND.',
        );
      }
    }

    // ─ Execute in transaction ───────────────────────────────────────────
    let relatedRefundId: string | null = null;

    if (dto.action === DisputeResolutionAction.APPROVE_REFUND) {
      // Write refund via Module 4 refunds table (not ad hoc)
      const refund = await this.prisma.$transaction(async (tx) => {
        const r = await tx.refund.create({
          data: {
            orderId:     dispute.orderId,
            paymentId:   dto.refundPaymentId!,
            amount:      dto.refundAmount!,
            reason:      `Dispute resolution: ${dto.resolutionSummary}`,
            status:      'APPROVED',
            initiatedBy: actorUserId,
            approvedBy:  actorUserId,
          },
        });

        // Append ledger entry for the refund
        const order = await tx.order.findUnique({ where: { id: dispute.orderId } });
        if (order) {
          await this.ledger.appendEntry(tx, {
            farmerProfileId: null,
            buyerProfileId:  order.buyerProfileId,
            entryType:       'CREDIT',
            amount:          dto.refundAmount!,
            currency:        order.currency,
            relatedOrderId:  dispute.orderId,
            relatedRefundId: r.id,
            description:     `Refund from dispute resolution: ${disputeId}`,
          });
        }

        return r;
      });
      relatedRefundId = refund.id;
    }

    const newStatus = dto.action === DisputeResolutionAction.ESCALATE ? 'ESCALATED' : 'RESOLVED';

    const updated = await this.prisma.dispute.update({
      where: { id: disputeId },
      data:  {
        status:             newStatus,
        resolutionSummary:  dto.resolutionSummary,
        resolvedByUserId:   actorUserId,
        resolvedAt:         new Date(),
        relatedRefundId,
      },
    });

    this.logger.log(
      `Dispute ${disputeId} ${newStatus} by user ${actorUserId} ` +
      `(global=${actorIsGlobal}, region=${actorRegionId}) action=${dto.action}`,
    );

    // ── Notify both parties of resolution ───────────────────────────────
    const resolvedOrder = await this.prisma.order.findUnique({
      where:  { id: updated.orderId },
      select: { farmerProfile: { select: { userId: true } }, buyerProfile: { select: { userId: true } } },
    });
    const resolvePayload = { disputeId: updated.id, orderId: updated.orderId, resolution: dto.action, status: newStatus };
    for (const uid of [resolvedOrder?.farmerProfile?.userId, resolvedOrder?.buyerProfile?.userId].filter(Boolean) as string[]) {
      await this.notifications.enqueueAll(uid, NotificationCategory.DISPUTE_RESOLVED, resolvePayload, `DISPUTE_RESOLVED:${updated.id}:${uid}`);
    }

    return updated;
  }

  // ─── EVIDENCE ────────────────────────────────────────────────────────────

  async addEvidence(disputeId: string, uploadedByUserId: string, {
    s3Key, mimeType, sizeBytes, description,
  }: { s3Key: string; mimeType: string; sizeBytes?: number; description?: string }) {
    const dispute = await this.loadDispute(disputeId);
    this.assertNotTerminal(dispute.status);

    return this.prisma.disputeEvidence.create({
      data: { disputeId, uploadedBy: uploadedByUserId, s3Key, mimeType, sizeBytes: sizeBytes ?? null, description: description ?? null },
    });
  }

  async listEvidence(disputeId: string) {
    return this.prisma.disputeEvidence.findMany({
      where:   { disputeId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── READ ──────────────────────────────────────────────────────────────

  async loadDispute(disputeId: string) {
    const d = await this.prisma.dispute.findUnique({
      where:   { id: disputeId },
      include: { evidence: true },
    });
    if (!d) throw new NotFoundException(`Dispute ${disputeId} not found.`);
    return d;
  }

  /** Regional-scoped list: REGIONAL_ADMIN sees only their region\'s disputes */
  async listByRegion(regionId: string) {
    return this.prisma.dispute.findMany({
      where:   { operationalRegionId: regionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Global list for PLATFORM_ADMIN */
  async listAll(status?: string) {
    return this.prisma.dispute.findMany({
      where:   status ? { status } : undefined,
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── PRIVATE ────────────────────────────────────────────────────────────

  private assertNotTerminal(status: string): void {
    const terminal = new Set(['RESOLVED', 'CLOSED']);
    if (terminal.has(status)) {
      throw new BadRequestException(
        `Dispute is in terminal status ${status} and cannot be modified.`,
      );
    }
  }
}
