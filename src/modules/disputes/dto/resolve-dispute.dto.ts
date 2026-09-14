import { IsString, IsNotEmpty, MaxLength, IsOptional, IsUUID, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DisputeResolutionAction {
  /** Close with a finding — no refund */
  CLOSE_NO_REFUND    = 'CLOSE_NO_REFUND',
  /** Approve a refund via Module 4 refunds table */
  APPROVE_REFUND     = 'APPROVE_REFUND',
  /** Escalate to PLATFORM_ADMIN */
  ESCALATE           = 'ESCALATE',
}

/**
 * RecommendDisputeDto
 *
 * Used by:
 *   - SUPPORT_MODERATOR (dispute:recommend)
 *   - Destination-region REGIONAL_ADMIN when order is cross-border (dispute:recommend only)
 *
 * A recommendation does NOT change the dispute status to RESOLVED.
 * It moves it to RECOMMENDED and records the suggestion for the operational-region admin.
 */
export class RecommendDisputeDto {
  @ApiProperty({ maxLength: 3000, description: 'Recommendation text from the moderator' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  recommendationSummary: string;
}

/**
 * ResolveDisputeDto
 *
 * Used ONLY by:
 *   - Operational-region REGIONAL_ADMIN (dispute:resolve:regional)
 *   - PLATFORM_ADMIN (dispute:resolve:global)
 *
 * Destination-region admin and SUPPORT_MODERATOR CANNOT call this.
 * Service enforces this via regionId matching on the dispute.operational_region_id.
 *
 * If action = APPROVE_REFUND, the refund goes through Module 4\'s
 * refunds table / PaymentsService. No ad hoc refund mechanism.
 */
export class ResolveDisputeDto {
  @ApiProperty({ enum: DisputeResolutionAction })
  @IsEnum(DisputeResolutionAction)
  action: DisputeResolutionAction;

  @ApiProperty({ maxLength: 3000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3000)
  resolutionSummary: string;

  /** Required when action = APPROVE_REFUND */
  @ApiPropertyOptional({ description: 'Refund amount (required when action = APPROVE_REFUND)' })
  @IsOptional()
  refundAmount?: number;

  @ApiPropertyOptional({ description: 'Payment UUID to refund against (required when action = APPROVE_REFUND)' })
  @IsOptional()
  @IsUUID()
  refundPaymentId?: string;
}
