import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { VerificationStatus } from '@prisma/client';

/**
 * Admin decision on a pending expert KYC submission. Only the two terminal
 * review outcomes are accepted — PENDING is not a decision an admin can set.
 */
export class ApproveRejectKycDto {
  @IsIn([VerificationStatus.VERIFIED, VerificationStatus.REJECTED], {
    message: 'status must be VERIFIED or REJECTED',
  })
  status!: typeof VerificationStatus.VERIFIED | typeof VerificationStatus.REJECTED;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNotes?: string;
}
