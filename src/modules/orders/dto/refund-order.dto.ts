import { IsUUID, IsNumber, IsPositive, IsOptional, IsString, MaxLength, IsEnum } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum RefundStatus { PENDING = 'PENDING', APPROVED = 'APPROVED', PROCESSED = 'PROCESSED', REJECTED = 'REJECTED', FAILED = 'FAILED' }

/** POST /orders/:id/refunds — refund is its own event, NOT just a payments.status flip */
export class InitiateRefundDto {
  @ApiProperty() @IsUUID() paymentId: string;
  @ApiProperty({ minimum: 0.01 }) @IsNumber({ maxDecimalPlaces: 4 }) @IsPositive() amount: number;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}

/** PATCH /orders/:orderId/refunds/:refundId/approve — SUPPORT_MODERATOR or REGIONAL_ADMIN */
export class ApproveRefundDto {
  @ApiProperty({ enum: [RefundStatus.APPROVED, RefundStatus.REJECTED] })
  @IsEnum([RefundStatus.APPROVED, RefundStatus.REJECTED])
  decision: RefundStatus.APPROVED | RefundStatus.REJECTED;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) note?: string;
}
