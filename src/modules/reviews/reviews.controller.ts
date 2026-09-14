import {
  Controller, Post, Get, Patch, Param, Body, UseGuards, Request,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/enums/user-role.enum';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';

@ApiTags('reviews')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviewsService: ReviewsService) {}

  @Post()
  @ApiOperation({ summary: 'Submit a review for a completed order (two-way: BUYER→FARMER or FARMER→BUYER)' })
  async create(@Request() req: any, @Body() dto: CreateReviewDto) {
    return this.reviewsService.create(req.user.id, dto);
  }

  @Get('farmer/:farmerProfileId')
  @ApiOperation({ summary: 'List visible reviews for a farmer profile' })
  async listForFarmer(@Param('farmerProfileId') farmerProfileId: string) {
    return this.reviewsService.listForFarmer(farmerProfileId);
  }

  @Get('buyer/:buyerProfileId')
  @ApiOperation({ summary: 'List visible reviews for a buyer profile' })
  async listForBuyer(@Param('buyerProfileId') buyerProfileId: string) {
    return this.reviewsService.listForBuyer(buyerProfileId);
  }

  @Get('order/:orderId')
  @Roles(UserRole.SUPPORT_MODERATOR, UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Admin: all reviews for an order (including hidden)' })
  async listForOrder(@Param('orderId') orderId: string) {
    return this.reviewsService.listForOrder(orderId);
  }

  @Patch(':reviewId/hide')
  @Roles(UserRole.SUPPORT_MODERATOR, UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Hide a review (soft — record preserved)' })
  async hideReview(
    @Param('reviewId') reviewId: string,
    @Body('reason') reason: string,
  ) {
    return this.reviewsService.hideReview(reviewId, reason);
  }

  @Patch(':reviewId/restore')
  @Roles(UserRole.SUPPORT_MODERATOR, UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Restore a hidden review' })
  async restoreReview(@Param('reviewId') reviewId: string) {
    return this.reviewsService.restoreReview(reviewId);
  }
}
