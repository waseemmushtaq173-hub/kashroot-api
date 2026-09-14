import {
  IsUUID,
  IsOptional,
  IsString,
  IsDateString,
  MaxLength,
  IsNotEmpty,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Submitted by the BUYER when requesting an appointment.
 * farmerProfileId is the target farmer's profile UUID (NOT user ID).
 * Buyer's own profile is resolved server-side via buyer_profiles.user_id.
 */
export class CreateAppointmentDto {
  @ApiProperty({ description: 'Target farmer profile UUID (not user ID)' })
  @IsUUID()
  farmerProfileId: string;

  @ApiPropertyOptional({ description: 'Listing UUID the appointment concerns (optional)' })
  @IsOptional()
  @IsUUID()
  listingId?: string;

  @ApiProperty({ example: '2026-10-15T08:00:00Z', description: 'Proposed start time — UTC ISO-8601' })
  @IsDateString()
  @IsNotEmpty()
  proposedStartUtc: string;

  @ApiProperty({ example: '2026-10-15T09:00:00Z', description: 'Proposed end time — UTC ISO-8601' })
  @IsDateString()
  @IsNotEmpty()
  proposedEndUtc: string;

  @ApiProperty({ example: 'Asia/Kolkata', description: 'IANA timezone for buyer — stored for UI, does not affect UTC storage' })
  @IsString()
  @IsNotEmpty()
  requesterTimezone: string;

  @ApiPropertyOptional({ example: 'Interested in 50 kg Grade A saffron.', maxLength: 1000 })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
