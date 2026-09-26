import { IsUUID, IsInt, Min } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * CreateOrderDto — submitted by BUYER to place an order.
 * buyerProfileId is NOT accepted from the client; it is resolved server-side
 * from the authenticated user (see OrdersController).
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
}
