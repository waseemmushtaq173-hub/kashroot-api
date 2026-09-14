import { IsUUID, IsEnum, IsOptional, IsBoolean, IsObject, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

// ─── Enums (mirrored from Prisma schema) ────────────────────────────────────

export enum NotificationCategory {
  APPOINTMENT_REQUESTED   = 'APPOINTMENT_REQUESTED',
  APPOINTMENT_CONFIRMED   = 'APPOINTMENT_CONFIRMED',
  APPOINTMENT_CANCELLED   = 'APPOINTMENT_CANCELLED',
  APPOINTMENT_REMINDER    = 'APPOINTMENT_REMINDER',
  APPOINTMENT_NO_SHOW     = 'APPOINTMENT_NO_SHOW',
  ORDER_STATUS_CHANGED    = 'ORDER_STATUS_CHANGED',
  ORDER_PLACED            = 'ORDER_PLACED',
  ORDER_COMPLETED         = 'ORDER_COMPLETED',
  RESERVATION_EXPIRED     = 'RESERVATION_EXPIRED',
  DISPUTE_OPENED          = 'DISPUTE_OPENED',
  DISPUTE_RESOLVED        = 'DISPUTE_RESOLVED',
  DISPUTE_RECOMMENDED     = 'DISPUTE_RECOMMENDED',
  REVIEW_RECEIVED         = 'REVIEW_RECEIVED',
  PAYMENT_SUCCEEDED       = 'PAYMENT_SUCCEEDED',
  PAYMENT_FAILED          = 'PAYMENT_FAILED',
  PRIVACY_REQUEST_FULFILLED = 'PRIVACY_REQUEST_FULFILLED',
}

export enum NotificationChannel {
  EMAIL = 'EMAIL',
  SMS   = 'SMS',
  PUSH  = 'PUSH',
}

/** All channels in a fixed order — used when broadcasting across all channels. */
export const ALL_CHANNELS = [
  NotificationChannel.EMAIL,
  NotificationChannel.SMS,
  NotificationChannel.PUSH,
] as const;

// ─── Enqueue DTO ─────────────────────────────────────────────────────────────

/**
 * EnqueueNotificationDto
 * Used internally (service-to-service) to schedule a notification.
 * Not exposed on a public REST endpoint.
 *
 * payload: category-specific JSON — rendered by each channel sender.
 * idempotencyKey: '<category>:<entityId>' — omit for non-deduped alerts.
 */
export class EnqueueNotificationDto {
  @ApiProperty() @IsUUID()             userId:         string;
  @ApiProperty({ enum: NotificationCategory }) @IsEnum(NotificationCategory)
  category: NotificationCategory;
  @ApiProperty({ enum: NotificationChannel }) @IsEnum(NotificationChannel)
  channel: NotificationChannel;
  @ApiPropertyOptional()               @IsOptional() @IsObject()
  payload?: Record<string, unknown>;
  @ApiPropertyOptional()               @IsOptional() @IsString()
  idempotencyKey?: string;
  @ApiPropertyOptional()               @IsOptional() @IsString()
  scheduledFor?: string; // ISO-8601
}

// ─── Preference DTO ───────────────────────────────────────────────────────────

export class UpdateNotificationPreferenceDto {
  @ApiProperty({ enum: NotificationCategory }) @IsEnum(NotificationCategory)
  category: NotificationCategory;
  @ApiProperty({ enum: NotificationChannel })  @IsEnum(NotificationChannel)
  channel: NotificationChannel;
  @ApiProperty()                               @IsBoolean()
  enabled: boolean;
}
