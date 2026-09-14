import { IsUUID, IsNotEmpty, IsNumber, IsPositive, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * CreateOrderDto — submitted by BUYER to place an order.
 * Ownership: buyerProfileId resolved server-side via buyer_profiles.user_id.
 * Gates (all in one $transaction):
 *   1. Region-pair enablement (hard reject if route disabled)
 *   2. Appointment trust-gate: isAppointmentCompleted() — NOT isAppointmentConfirmed()
 *   3. Inventory reservation commit (Module 2 pipeline)
 *   4. Pricing snapshot write
 *   5. Order row insert
 * trade_direction NOT stored — use TradeDirectionService.getTradeDirection().
 */
export class CreateOrderDto {
  @ApiProperty() @IsUUID() listingId: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() inventoryReservationId?: string;
  @ApiProperty({ minimum: 0.001 }) @IsNumber({ maxDecimalPlaces: 4 }) @IsPositive() quantity: number;
  @ApiProperty({ description: 'Buyer destination region UUID' }) @IsUUID() destinationRegionId: string;
  @ApiProperty({ description: 'Unique idempotency key per payment attempt' }) @IsString() @IsNotEmpty() @MaxLength(128) paymentIdempotencyKey: string;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
