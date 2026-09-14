import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger }                 from '@nestjs/common';
import { Job }                    from 'bullmq';
import { PrismaService }          from '../../prisma/prisma.service';
import { EmailSender }            from './senders/email.sender';
import { SmsSender }              from './senders/sms.sender';
import { PushSender }             from './senders/push.sender';
import { NOTIFICATION_QUEUE }     from './notifications.service';

/**
 * NotificationProcessor — BullMQ worker.
 *
 * Picks up 'send' jobs from the notification queue.
 * Each job carries { notificationQueueId } — we re-fetch from DB to get
 * the full row so we always work with the latest state.
 *
 * Dispatch logic:
 *   EMAIL → EmailSender.send()  (requires user email from users table)
 *   SMS   → SmsSender.send()   (requires user phone from users table)
 *   PUSH  → PushSender.send()  (requires FCM tokens from user_push_tokens — see note)
 *
 * On failure:
 *   - The job throws an error.
 *   - BullMQ catches it, increments attemptsMade, and retries with exponential backoff
 *     (configured in NotificationsService.enqueue: 5 attempts, 5s base delay).
 *   - On final failure: notification_queue.status = 'FAILED', last_error populated.
 *
 * NOTE: user_push_tokens table is not yet in scope. The PUSH path falls back to an
 * empty tokens array (PushSender logs and no-ops). Add the table + token registration
 * endpoint before enabling production push delivery.
 */
@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor extends WorkerHost {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly email:  EmailSender,
    private readonly sms:    SmsSender,
    private readonly push:   PushSender,
  ) {
    super();
  }

  async process(job: Job<{ notificationQueueId: string }>): Promise<void> {
    const { notificationQueueId } = job.data;

    // Fetch queue row
    const row = await this.prisma.notificationQueue.findUnique({
      where: { id: notificationQueueId },
    });

    if (!row) {
      this.logger.warn(`NotificationProcessor: row not found id=${notificationQueueId}`);
      return; // Don't retry — the row was deleted or never created
    }

    if (row.status === 'SENT' || row.status === 'SKIPPED') {
      this.logger.log(`NotificationProcessor: skipping already-${row.status} id=${notificationQueueId}`);
      return;
    }

    // Fetch user contact info
    const user = await this.prisma.user.findUnique({
      where:  { id: row.userId },
      select: { id: true, email: true, phone: true },
    });

    if (!user) {
      await this.markFailed(notificationQueueId, 'User not found — cannot dispatch notification.');
      return;
    }

    // Increment attempt_count
    await this.prisma.notificationQueue.update({
      where: { id: notificationQueueId },
      data:  { attemptCount: { increment: 1 } },
    });

    try {
      const payload = row.payload as Record<string, unknown>;

      switch (row.channel) {
        case 'EMAIL': {
          if (!user.email) throw new Error('User has no email address.');
          await this.email.send({
            userId:   user.id,
            category: row.category,
            payload,
            toEmail:  user.email,
          });
          break;
        }

        case 'SMS': {
          if (!user.phone) throw new Error('User has no phone number.');
          await this.sms.send({
            userId:   user.id,
            category: row.category,
            payload,
            toPhone:  user.phone,
          });
          break;
        }

        case 'PUSH': {
          // TODO: replace [] with real FCM tokens from user_push_tokens table
          // when mobile client registration is implemented.
          const fcmTokens: string[] = [];
          await this.push.send({
            userId:    user.id,
            category:  row.category,
            payload,
            fcmTokens,
          });
          break;
        }

        default:
          throw new Error(`Unknown notification channel: ${row.channel}`);
      }

      // Mark SENT
      await this.prisma.notificationQueue.update({
        where: { id: notificationQueueId },
        data:  { status: 'SENT', sentAt: new Date() },
      });

      this.logger.log(
        `NotificationProcessor: sent id=${notificationQueueId} ` +
        `cat=${row.category} ch=${row.channel} userId=${user.id}`,
      );

    } catch (err: any) {
      const isLastAttempt = job.attemptsMade >= (job.opts.attempts ?? 5) - 1;

      if (isLastAttempt) {
        await this.markFailed(notificationQueueId, err?.message ?? String(err));
        this.logger.error(
          `NotificationProcessor: FAILED (final) id=${notificationQueueId}: ${err?.message}`,
        );
      } else {
        this.logger.warn(
          `NotificationProcessor: attempt ${job.attemptsMade + 1} failed for ` +
          `id=${notificationQueueId}: ${err?.message}. Will retry.`,
        );
      }

      // Always re-throw so BullMQ can apply its retry/backoff logic
      throw err;
    }
  }

  private async markFailed(id: string, errorMessage: string): Promise<void> {
    await this.prisma.notificationQueue.update({
      where: { id },
      data:  { status: 'FAILED', lastError: errorMessage, failedAt: new Date() },
    });
  }
}
