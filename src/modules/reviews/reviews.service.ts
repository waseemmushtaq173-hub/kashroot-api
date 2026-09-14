import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ForbiddenException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto, ReviewerRole } from './dto/create-review.dto';

/** Order statuses that allow review creation */
const REVIEWABLE_STATUSES = new Set(['DELIVERED', 'COMPLETED']);

/**
 * ReviewsService
 *
 * Reviews are two-way: BUYER reviews FARMER, FARMER reviews BUYER.
 * Both directions are tied to the same completed order.
 *
 * Rules (all enforced server-side):
 *   1. order.status must be DELIVERED or COMPLETED (hard reject)
 *   2. One review per direction per order (unique constraint)
 *   3. Reviewer profile resolved via user_id (never raw profile id)
 *   4. Reviewer must actually be the buyer or farmer on the order
 *   5. Reviewee is determined automatically from the order (no client input)
 *
 * Visibility:
 *   - SUPPORT_MODERATOR+ can hide a review (is_visible=false + hidden_reason)
 *   - Hidden reviews are excluded from public listing queries
 */
@Injectable()
export class ReviewsService {
  private readonly logger = new Logger(ReviewsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────

  async create(actorUserId: string, dto: CreateReviewDto) {
    // 1. Load order
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
    });
    if (!order) throw new NotFoundException(`Order ${dto.orderId} not found.`);

    // 2. Enforce reviewable status
    if (!REVIEWABLE_STATUSES.has(order.status)) {
      throw new BadRequestException(
        `Reviews can only be submitted for DELIVERED or COMPLETED orders. ` +
        `This order is currently: ${order.status}.`,
      );
    }

    // 3. Resolve reviewer and reviewee profile IDs via user_id (never raw id)
    let reviewerProfileId: string;
    let revieweeProfileId: string;

    if (dto.reviewerRole === ReviewerRole.BUYER) {
      const buyerProfile = await this.prisma.buyerProfile.findUnique({
        where: { userId: actorUserId },
      });
      if (!buyerProfile) throw new NotFoundException('Buyer profile not found.');

      // Verify this buyer is actually on the order
      if (buyerProfile.id !== order.buyerProfileId) {
        throw new ForbiddenException('You are not the buyer on this order.');
      }

      reviewerProfileId = buyerProfile.id;
      revieweeProfileId = order.farmerProfileId; // farmer is the reviewee

    } else {
      // ReviewerRole.FARMER
      const farmerProfile = await this.prisma.farmerProfile.findUnique({
        where: { userId: actorUserId },
      });
      if (!farmerProfile) throw new NotFoundException('Farmer profile not found.');

      // Verify this farmer is actually on the order
      if (farmerProfile.id !== order.farmerProfileId) {
        throw new ForbiddenException('You are not the farmer on this order.');
      }

      reviewerProfileId = farmerProfile.id;
      revieweeProfileId = order.buyerProfileId; // buyer is the reviewee
    }

    // 4. Write review (unique constraint catches duplicate direction)
    try {
      const review = await this.prisma.review.create({
        data: {
          orderId:            dto.orderId,
          reviewerProfileId,
          revieweeProfileId,
          reviewerRole:       dto.reviewerRole,
          rating:             dto.rating,
          body:               dto.body ?? null,
          isVisible:          true,
        },
      });

      this.logger.log(
        `Review created: ${review.id} | order=${dto.orderId} ` +
        `reviewer=${dto.reviewerRole} rating=${dto.rating}`,
      );
      return review;

    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Prisma unique constraint violation
        throw new ConflictException(
          `You have already submitted a ${dto.reviewerRole} review for this order.`,
        );
      }
      throw err;
    }
  }

  // ─── READ ──────────────────────────────────────────────────────────────

  /** Public: visible reviews for a farmer profile */
  async listForFarmer(farmerProfileId: string) {
    return this.prisma.review.findMany({
      where:   { revieweeProfileId: farmerProfileId, reviewerRole: ReviewerRole.BUYER, isVisible: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Public: visible reviews for a buyer profile */
  async listForBuyer(buyerProfileId: string) {
    return this.prisma.review.findMany({
      where:   { revieweeProfileId: buyerProfileId, reviewerRole: ReviewerRole.FARMER, isVisible: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  /** Admin: all reviews for an order (visible + hidden) */
  async listForOrder(orderId: string) {
    return this.prisma.review.findMany({
      where:   { orderId },
      orderBy: { createdAt: 'desc' },
    });
  }

  // ─── MODERATION ────────────────────────────────────────────────────────────

  /** SUPPORT_MODERATOR+: hide a review (soft — record preserved, hidden from public) */
  async hideReview(reviewId: string, hiddenReason: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found.`);

    return this.prisma.review.update({
      where: { id: reviewId },
      data:  { isVisible: false, hiddenReason },
    });
  }

  /** SUPPORT_MODERATOR+: restore a hidden review */
  async restoreReview(reviewId: string) {
    const review = await this.prisma.review.findUnique({ where: { id: reviewId } });
    if (!review) throw new NotFoundException(`Review ${reviewId} not found.`);

    return this.prisma.review.update({
      where: { id: reviewId },
      data:  { isVisible: true, hiddenReason: null },
    });
  }
}
