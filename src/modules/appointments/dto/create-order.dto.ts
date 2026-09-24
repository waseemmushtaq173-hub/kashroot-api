import { IsNotEmpty, IsNumber, IsPositive, IsString, IsUUID } from 'class-validator';

export class CreateOrderDto {
  @IsUUID()
  @IsNotEmpty()
  buyerProfileId: string;

  @IsUUID()
  @IsNotEmpty()
  listingId: string;

  @IsNumber()
  @IsPositive()
  quantity: number;

  @IsUUID()
  @IsNotEmpty()
  appointmentId: string;

  @IsUUID()
  @IsNotEmpty()
  feeConfigVersionId: string;
}