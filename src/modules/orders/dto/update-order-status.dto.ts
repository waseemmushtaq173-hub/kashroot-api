import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum OrderStatus {
  PLACED = 'PLACED', CONFIRMED = 'CONFIRMED', PACKED = 'PACKED', SHIPPED = 'SHIPPED',
  CUSTOMS_CLEARANCE = 'CUSTOMS_CLEARANCE', OUT_FOR_DELIVERY = 'OUT_FOR_DELIVERY',
  DELIVERED = 'DELIVERED', COMPLETED = 'COMPLETED', CANCELLED = 'CANCELLED', DISPUTED = 'DISPUTED',
}

export const ORDER_STATUS_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  [OrderStatus.PLACED]:            [OrderStatus.CONFIRMED, OrderStatus.CANCELLED],
  [OrderStatus.CONFIRMED]:         [OrderStatus.PACKED,    OrderStatus.CANCELLED],
  [OrderStatus.PACKED]:            [OrderStatus.SHIPPED,   OrderStatus.CANCELLED],
  [OrderStatus.SHIPPED]:           [OrderStatus.CUSTOMS_CLEARANCE, OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED],
  [OrderStatus.CUSTOMS_CLEARANCE]: [OrderStatus.OUT_FOR_DELIVERY, OrderStatus.CANCELLED],
  [OrderStatus.OUT_FOR_DELIVERY]:  [OrderStatus.DELIVERED, OrderStatus.CANCELLED],
  [OrderStatus.DELIVERED]:         [OrderStatus.COMPLETED, OrderStatus.DISPUTED],
  [OrderStatus.COMPLETED]:         [],
  [OrderStatus.CANCELLED]:         [],
  [OrderStatus.DISPUTED]:          [OrderStatus.CANCELLED, OrderStatus.COMPLETED],
};

export class UpdateOrderStatusDto {
  @ApiProperty({ enum: OrderStatus }) @IsEnum(OrderStatus) status: OrderStatus;
  @ApiPropertyOptional({ maxLength: 1000 }) @IsOptional() @IsString() @MaxLength(1000) reason?: string;
}
