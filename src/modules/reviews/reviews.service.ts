import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateReviewDto) {
    const order = await this.prisma.order.findUnique({
      where: { id: dto.orderId },
      include: {
        buyerProfile: { select: { id: true, userId: true } },
        farmerProfile: { select: { id: true, userId: true } },
      },
    });

    if (!order) {
      throw new NotFoundException('Order not found');
    }

    const buyerProfile = await this.prisma.buyerProfile.findUnique({
      where: { userId },
      select: { id: true, userId: true },
    });

    const farmerProfile = await this.prisma.farmerProfile.findUnique({
      where: { userId },
      select: { id: true, userId: true },
    });

    const reviewerProfile = buyerProfile ?? farmerProfile;

    if (!reviewerProfile) {
      throw new NotFoundException('User profile not found');
    }

    const reviewerIsBuyer = order.buyerProfile.userId === userId;
    const reviewerIsFarmer = order.farmerProfile.userId === userId;

    if (!reviewerIsBuyer && !reviewerIsFarmer) {
      throw new BadRequestException('User is not a participant in this order');
    }

    const expectedRole = reviewerIsBuyer ? 'BUYER' : 'FARMER';

    if (dto.reviewerRole !== expectedRole) {
      throw new BadRequestException('Reviewer role does not match the order participant');
    }

    const revieweeProfileId = reviewerIsBuyer
      ? order.farmerProfile.id
      : order.buyerProfile.id;

    return this.prisma.review.create({
      data: {
        orderId: dto.orderId,
        reviewerProfileId: reviewerProfile.id,
        revieweeProfileId: revieweeProfileId,
        reviewerRole: dto.reviewerRole,
        rating: dto.rating,
        body: dto.body ?? null,
      },
    });
  }

  async listForFarmer(farmerProfileId: string) {
    return this.prisma.review.findMany({
      where: { order: { farmerProfileId } },
      include: { order: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForBuyer(buyerProfileId: string) {
    return this.prisma.review.findMany({
      where: { order: { buyerProfileId } },
      include: { order: true },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listForOrder(orderId: string) {
    return this.prisma.review.findMany({
      where: { orderId },
      include: { order: true },
    });
  }

  async hideReview(reviewId: string, reason: string) {
    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        isVisible: false,
        hiddenReason: reason ?? null,
      },
    });
  }

  async restoreReview(reviewId: string) {
    return this.prisma.review.update({
      where: { id: reviewId },
      data: {
        isVisible: true,
        hiddenReason: null,
      },
    });
  }
}