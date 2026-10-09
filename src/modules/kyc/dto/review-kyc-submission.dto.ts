import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';

/**
 * Admin decision on a pending KYC submission. Modelled on
 * ApproveRejectKycDto (expert KYC): only the two terminal outcomes are
 * accepted — PENDING is not a decision an admin can set.
 */
export class ReviewKycSubmissionDto {
  @ApiProperty({ enum: [VerificationStatus.VERIFIED, VerificationStatus.REJECTED] })
  @IsIn([VerificationStatus.VERIFIED, VerificationStatus.REJECTED], {
    message: 'status must be VERIFIED or REJECTED',
  })
  status!: typeof VerificationStatus.VERIFIED | typeof VerificationStatus.REJECTED;

  @ApiPropertyOptional({ example: 'Name on PAN does not match the bank account.' })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reviewNotes?: string;
}
