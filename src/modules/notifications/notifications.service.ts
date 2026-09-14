import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import {
  NotificationCategory,
  NotificationChannel,
  ALL_CHANNELS,
  EnqueueNotificationDto,
} from './dto/notification.dto';

export const NOTIFICATION_QUEUE = 'notification';

/**
 * NotificationsService
 *
 * Central notification broker. All notification sends from every module
 * flow through enqueue() — NEVER a synchronous send in a request cycle.
 *
 * Flow:
 *   1. enqueue() is called by a trigger point (appointments.service, orders.service, etc.)
 *   2. Preference check: if user has disabled category+channel, row is written with
 *      status=SKIPPED and we return immediately (logged, not an error).
 *   3. Row written to notification_queue with status=QUEUED.
 *   4. BullMQ job enqueued — notification.processor.ts picks it up.
 *   5. Processor dispatches to the right channel sender (email/sms/push).
 *   6. On success: status=SENT. On failure: status=FAILED, BullMQ retries with backoff.
 *
 * enqueueAll() broadcasts to all three channels, checking preferences per channel.
 * Idempotency: duplicate enqueue with same (userId, idempotencyKey) is a no-op.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly notifQueue: Queue,
  ) {}

  // ─── ENQUEUE (single channel) ───────────────────────────────────────────────────

  async enqueue(dto: EnqueueNotificationDto): Promise<string | null> {
    // 1. Preference check
    const prefEnabled = await this.isChannelEnabled(
      dto.userId, dto.category, dto.channel,
    );

    if (!prefEnabled) {
      this.logger.log(
        `Notification skipped (user preference): userId=${dto.userId} ` +
        `category=${dto.category} channel=${dto.channel}`,
      );
      // Write SKIPPED row for audit trail
      await this.prisma.notificationQueue.create({
        data: {
          userId:         dto.userId,
          category:       dto.category,
          channel:        dto.channel,
          status:         'SKIPPED',
          payload:        (dto.payload ?? {}) as any,
          idempotencyKey: dto.idempotencyKey ?? null,
          scheduledFor:   dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        },
      });
      return null;
    }

    // 2. Write QUEUED row (idempotency constraint catches duplicates gracefully)
    let row: any;
    try {
      row = await this.prisma.notificationQueue.create({
        data: {
          userId:         dto.userId,
          category:       dto.category,
          channel:        dto.channel,
          status:         'QUEUED',
          payload:        (dto.payload ?? {}) as any,
          idempotencyKey: dto.idempotencyKey ?? null,
          scheduledFor:   dto.scheduledFor ? new Date(dto.scheduledFor) : null,
        },
      });
    } catch (err: any) {
      if (err?.code === 'P2002') {
        // Unique constraint on (userId, idempotencyKey) — already enqueued
        this.logger.log(
          `Notification dedup: userId=${dto.userId} key=${dto.idempotencyKey} — skipping.`,
        );
        return null;
      }
      throw err;
    }

    // 3. Add BullMQ job — processor will dispatch to channel sender
    const delay = dto.scheduledFor
      ? Math.max(0, new Date(dto.scheduledFor).getTime() - Date.now())
      : 0;

    await this.notifQueue.add(
      'send',
      { notificationQueueId: row.id },
      {
        delay,
        attempts:    5,
        backoff:     { type: 'exponential', delay: 5_000 },
        removeOnComplete: { count: 1_000 },
        removeOnFail:     { count: 5_000 },
      },
    );

    this.logger.log(
      `Notification enqueued: id=${row.id} userId=${dto.userId} ` +
      `category=${dto.category} channel=${dto.channel}`,
    );
    return row.id;
  }

  // ─── ENQUEUE ALL CHANNELS ───────────────────────────────────────────────────────

  /**
   * enqueueAll
   * Broadcasts one notification across EMAIL, SMS, PUSH.
   * Preference check runs per channel — each channel is independent.
   * idempotencyKey is suffixed with the channel name for uniqueness.
   */
  async enqueueAll(
    userId:         string,
    category:       NotificationCategory,
    payload:        Record<string, unknown>,
    idempotencyKey?: string,
  ): Promise<void> {
    await Promise.all(
      ALL_CHANNELS.map((channel) =>
        this.enqueue({
          userId,
          category,
          channel,
          payload,
          idempotencyKey: idempotencyKey ? `${idempotencyKey}:${channel}` : undefined,
        }),
      ),
    );
  }

  // ─── PREFERENCES ────────────────────────────────────────────────────────────

  /**
   * isChannelEnabled
   * Returns true if the user has NOT disabled this category+channel.
   * Absent preference row = enabled (opt-out model).
   */
  async isChannelEnabled(
    userId:   string,
    category: NotificationCategory,
    channel:  NotificationChannel,
  ): Promise<boolean> {
    const pref = await this.prisma.notificationPreference.findUnique({
      where: {
        uq_notif_pref: { userId, category, channel } as any,
      },
    });
    // Absent = enabled; present with enabled=false = disabled
    return pref === null || pref.enabled === true;
  }

  async setPreference(
    userId:   string,
    category: NotificationCategory,
    channel:  NotificationChannel,
    enabled:  boolean,
  ) {
    return this.prisma.notificationPreference.upsert({
      where:  { uq_notif_pref: { userId, category, channel } as any },
      update: { enabled, updatedAt: new Date() },
      create: { userId, category, channel, enabled },
    });
  }

  async getPreferences(userId: string) {
    return this.prisma.notificationPreference.findMany({ where: { userId } });
  }

  // ─── QUEUE HISTORY (for REST missed-updates endpoint) ───────────────────────────

  async getHistory(userId: string, since?: string, limit = 50) {
    return this.prisma.notificationQueue.findMany({
      where: {
        userId,
        status: { in: ['SENT', 'FAILED'] },
        ...(since ? { createdAt: { gte: new Date(since) } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(limit, 200),
    });
  }
}
