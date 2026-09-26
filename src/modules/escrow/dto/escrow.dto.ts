import { IsUUID, IsOptional, IsString, MaxLength } from 'class-validator';

/** Body for POST /escrow/hold — secure an order's funds in the vault. */
export class HoldEscrowDto {
  @IsUUID()
  orderId!: string;
}

/** Body for POST /escrow/:orderId/refund — automated dispute/cancellation refund. */
export class RefundEscrowDto {
  /** Refund record this movement relates to (dispute resolution id, etc.). */
  @IsOptional()
  @IsUUID()
  refundId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
