import { IsDateString, IsString, IsOptional, IsNotEmpty, MaxLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * POST /appointments/:id/reschedule
 * Either party may reschedule. Service:
 *   1. Old appointment → RESCHEDULED (kept for audit).
 *   2. New appointment row → REQUESTED, old.rescheduled_to_id = new.id.
 *   3. Old BullMQ reminder job CANCELLED immediately.
 *   4. New reminder scheduled when new appointment reaches CONFIRMED.
 */
export class RescheduleAppointmentDto {
  @ApiProperty({ example: '2026-10-20T08:00:00Z', description: 'New start — UTC ISO-8601' })
  @IsDateString() @IsNotEmpty()
  newStartUtc: string;

  @ApiProperty({ example: '2026-10-20T09:00:00Z', description: 'New end — UTC ISO-8601' })
  @IsDateString() @IsNotEmpty()
  newEndUtc: string;

  @ApiProperty({ example: 'Asia/Kolkata', description: 'IANA timezone of rescheduling party' })
  @IsString() @IsNotEmpty()
  requesterTimezone: string;

  @ApiPropertyOptional({ example: 'Harvest delay — the 20th works better.', maxLength: 500 })
  @IsOptional() @IsString() @MaxLength(500)
  reason?: string;
}
