import { IsUUID, IsInt, Min, Max, IsOptional, IsString, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum ReviewerRole {
  FARMER = 'FARMER',
  BUYER  = 'BUYER',
}

/**
 * CreateReviewDto
 *
 * Reviews are two-way: a BUYER can review the FARMER and vice versa.
 * Both must be tied to the same completed order.
 *
 * Service enforces:
 *   - order.status must be DELIVERED or COMPLETED (hard reject otherwise)
 *   - one review per direction per order (unique constraint)
 *   - reviewer's profile is resolved via user_id (never raw profile id)
 */
export class CreateReviewDto {
  @ApiProperty({ description: 'Order UUID this review is for (must be DELIVERED or COMPLETED)' })
  @IsUUID()
  orderId: string;

  @ApiProperty({ enum: ReviewerRole, description: 'Role of the user submitting this review' })
  @IsEnum(ReviewerRole)
  reviewerRole: ReviewerRole;

  @ApiProperty({ description: 'Rating 1–5', minimum: 1, maximum: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating: number;

  @ApiPropertyOptional({ description: 'Review text (optional)', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  body?: string;
}
