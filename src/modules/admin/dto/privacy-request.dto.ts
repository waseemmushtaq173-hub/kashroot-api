import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum PrivacyRequestType {
  EXPORT   = 'EXPORT',
  DELETION = 'DELETION',
}

/**
 * CreatePrivacyRequestDto — POST /admin/privacy-requests (or /users/me/privacy-requests)
 *
 * EXPORT: generates a data export archive of the user\'s personal data.
 * DELETION:
 *   ─ Does NOT delete completed orders, payments, or ledger_entries.
 *   ─ Nulls/redacts PII fields on users, farmer_profiles, buyer_profiles.
 *   ─ Preserves financial record IDs and amounts (per retention policy).
 *   ─ Populates retained_data_note with explanation of what was kept and why.
 */
export class CreatePrivacyRequestDto {
  @ApiProperty({ enum: PrivacyRequestType })
  @IsEnum(PrivacyRequestType)
  type: PrivacyRequestType;
}

/**
 * FulfillPrivacyRequestDto — PATCH /admin/privacy-requests/:id/fulfill
 * Called by PLATFORM_ADMIN or the automated privacy worker.
 */
export class FulfillPrivacyRequestDto {
  @ApiPropertyOptional({ maxLength: 5000, description: 'Explanation of what data was retained and why' })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  retainedDataNote?: string;

  @ApiPropertyOptional({ description: 'S3 key for the exported data archive (EXPORT type only)' })
  @IsOptional()
  @IsString()
  exportS3Key?: string;
}

/**
 * RejectPrivacyRequestDto — PATCH /admin/privacy-requests/:id/reject
 */
export class RejectPrivacyRequestDto {
  @ApiProperty({ maxLength: 1000 })
  @IsString()
  @MaxLength(1000)
  rejectionReason: string;
}
