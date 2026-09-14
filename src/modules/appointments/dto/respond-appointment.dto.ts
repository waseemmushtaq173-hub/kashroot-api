import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export enum AppointmentRespondAction {
  CONFIRM = 'CONFIRM',
  DECLINE = 'DECLINE',
}

/** PATCH /appointments/:id/respond — farmer confirms or declines a request */
export class RespondAppointmentDto {
  @ApiProperty({ enum: AppointmentRespondAction })
  @IsEnum(AppointmentRespondAction)
  action: AppointmentRespondAction;

  @ApiPropertyOptional({ example: 'Asia/Kolkata', description: 'Farmer IANA timezone stored for UI rendering' })
  @IsOptional() @IsString()
  farmerTimezone?: string;

  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  farmerNote?: string;
}

/**
 * PATCH /appointments/:id/no-show
 * Either party flags the other. no_show_party resolved server-side from caller role:
 *   FARMER calls → no_show_party = 'BUYER'
 *   BUYER  calls → no_show_party = 'FARMER'
 * Service increments profile.no_show_count; if >= threshold writes audit flag.
 */
export class MarkNoShowDto {
  @ApiPropertyOptional({ maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  note?: string;
}

/**
 * PATCH /appointments/:id/complete — FARMER only
 * CRITICAL: Only COMPLETED satisfies the trust-gate for checkout.
 * CONFIRMED alone is NOT sufficient — see isAppointmentCompleted().
 */
export class CompleteAppointmentDto {
  @ApiPropertyOptional({ maxLength: 1000 })
  @IsOptional() @IsString() @MaxLength(1000)
  outcomeNotes?: string;
}
