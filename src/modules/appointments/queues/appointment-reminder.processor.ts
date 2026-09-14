import { Processor, WorkerHost, OnWorkerEvent } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { PrismaService } from '../../../prisma/prisma.service';
import { APPOINTMENT_REMINDER_QUEUE } from '../appointments.service';
import { NotificationsService } from '../../notifications/notifications.service';
import { NotificationCategory } from '../../notifications/dto/notification.dto';

/**
 * AppointmentReminderProcessor
 *
 * Handles the 'send-reminder' job, which is enqueued with a delay by
 * AppointmentsService.respond() (when farmer CONFIRMS an appointment).
 *
 * Job lifecycle:
 *   1. Farmer confirms → AppointmentsService.respond() calls scheduleReminderJob()
 *      which enqueues: reminderQueue.add('send-reminder', payload, { delay })
 *      where delay = startTimeUtc.getTime() - Date.now() - APPOINTMENT_REMINDER_LEAD_MS
 *
 *   2. Job is removed (via job.remove()) if:
 *      - The appointment is cancelled:   AppointmentsService.cancel()
 *      - The appointment is rescheduled: AppointmentsService.reschedule()
 *      - The appointment is completed:   AppointmentsService.complete()
 *      - A no-show is flagged:           AppointmentsService.markNoShow()
 *      This prevents a stale reminder firing for a time slot that no
 *      longer exists in its original form.
 *
 *   3. Before sending, the processor re-validates the appointment in the DB
 *      (idempotency guard) in case the job fires despite a failed removal.
 *
 * Notification strategy:
 *   The processor writes a notification_queue row (or calls an event bus)
 *   rather than sending SMS/email directly — keeping the processor thin
 *   and decoupled from the notification transport chosen in Module 6.
 */
@Processor(APPOINTMENT_REMINDER_QUEUE)
export class AppointmentReminderProcessor extends WorkerHost {
  private readonly logger = new Logger(AppointmentReminderProcessor.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationsService,
  ) {
    super();
  }

  // ─────────────────────────────────────────────────────────────────────────
  // JOB HANDLER
  // ─────────────────────────────────────────────────────────────────────────

  async process(job: Job<AppointmentReminderPayload>): Promise<void> {
    const { appointmentId, farmerProfileId, buyerProfileId, startTimeUtc } = job.data;

    this.logger.log(
      `[job:${job.id}] Processing reminder for appointment ${appointmentId} ` +
      `starting at ${startTimeUtc}`,
    );

    // ─── IDEMPOTENCY GUARD ──────────────────────────────────────────────────────
    // Re-validate the appointment. If it is no longer CONFIRMED, skip
    // silently — a cancellation or reschedule may have removed the job
    // from the queue before it fired, but a race can occasionally let
    // the job through. We must not send a reminder for a stale slot.
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      select: {
        id:              true,
        status:          true,
        startTimeUtc:    true,
        endTimeUtc:      true,
        farmerProfileId: true,
        buyerProfileId:  true,
        farmerProfile: { select: { userId: true, displayName: true } },
        buyerProfile:  { select: { userId: true, displayName: true } },
      },
    });

    if (!appointment) {
      this.logger.warn(`[job:${job.id}] Appointment ${appointmentId} not found. Skipping.`);
      return;
    }

    if (appointment.status !== 'CONFIRMED') {
      this.logger.warn(
        `[job:${job.id}] Appointment ${appointmentId} is no longer CONFIRMED ` +
        `(status: ${appointment.status}). Stale reminder — skipping.`,
      );
      return;
    }

    // ─── EMIT REMINDER NOTIFICATIONS via NotificationsService ────────────────────
    // Enqueues through the proper notification pipeline (preference-check +
    // BullMQ dispatch to email/sms/push senders). One enqueueAll per recipient.

    const recipientUserIds = [
      (appointment.farmerProfile as any)?.userId,
      (appointment.buyerProfile as any)?.userId,
    ].filter(Boolean) as string[];

    const notificationPayload = {
      appointmentId:   appointment.id,
      startTimeUtc:    appointment.startTimeUtc.toISOString(),
      endTimeUtc:      appointment.endTimeUtc.toISOString(),
      farmerProfileId: appointment.farmerProfileId,
      buyerProfileId:  appointment.buyerProfileId,
    };

    await Promise.all(
      recipientUserIds.map((userId) =>
        this.notifications.enqueueAll(
          userId,
          NotificationCategory.APPOINTMENT_REMINDER,
          notificationPayload,
          `APPOINTMENT_REMINDER:${appointment.id}:${userId}`,
        ),
      ),
    );

    this.logger.log(
      `[job:${job.id}] Reminder notifications queued for ` +
      `${recipientUserIds.length} recipients (appointment ${appointmentId}).`,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // WORKER EVENTS
  // ─────────────────────────────────────────────────────────────────────────

  @OnWorkerEvent('completed')
  onCompleted(job: Job): void {
    this.logger.log(`[job:${job.id}] Reminder job completed.`);
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job, error: Error): void {
    this.logger.error(
      `[job:${job.id}] Reminder job failed (attempt ${job.attemptsMade}/${job.opts.attempts}): ${error.message}`,
      error.stack,
    );
  }
}

// ─── TYPES ─────────────────────────────────────────────────────────────────────────

export interface AppointmentReminderPayload {
  appointmentId:   string;
  farmerProfileId: string;
  buyerProfileId:  string;
  startTimeUtc:    Date | string;
}
