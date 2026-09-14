import { IsUUID, IsString, IsNotEmpty, MaxLength, IsEnum, IsOptional } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum DisputeType {
  PAYMENT  = 'PAYMENT',
  DELIVERY = 'DELIVERY',
  QUALITY  = 'QUALITY',
  FRAUD    = 'FRAUD',
  OTHER    = 'OTHER',
}

/**
 * CreateDisputeDto — POST /disputes
 *
 * Operational region is derived server-side from orders.origin_region_id
 * (the farmer's region = primary resolver). Never supplied by the client.
 *
 * If the order is cross-border, destination region admin gets
 * read + dispute:recommend access only.
 */
export class CreateDisputeDto {
  @ApiProperty({ description: 'Order UUID the dispute is about' })
  @IsUUID()
  orderId: string;

  @ApiProperty({ enum: DisputeType })
  @IsEnum(DisputeType)
  type: DisputeType;

  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title: string;

  @ApiProperty({ maxLength: 5000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(5000)
  description: string;

  @ApiPropertyOptional({ description: 'Related chat thread UUID for context (must be scoped to same order)' })
  @IsOptional()
  @IsUUID()
  relatedChatThreadId?: string;
}
