import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * CreateOrderDto — submitted by BUYER to place an order.
 * NOTE: buyerProfileId is accepted in the body for now; it will be resolved
 * server-side from the authenticated user token in a later iteration.
 */
export class CreateOrderDto {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  listingId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  appointmentId: string;

  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  feeConfigVersionId: string;

  // TODO: derive from req.user once auth wiring lands; trusted from body for now.
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  buyerProfileId: string;
}
