import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
  ConflictException,
  Logger,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectQueue } from '@nestjs/bullmq';
import { Queue } from 'bullmq';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';
import { TrustPoliciesService } from './trust-policies.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RespondAppointmentDto, AppointmentRespondAction, MarkNoShowDto, CompleteAppointmentDto } from './dto/respond-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';
import { Appointment } from '@prisma/client';
import { NotificationsService } from '../notifications/notifications.service';
import { NotificationCategory } from '../notifications/dto/notification.dto';

export const APPOINTMENT_REMINDER_QUEUE = 'appointment-reminder';

// How many ms before start_time_utc to fire the reminder job.
// Default: 24 hours. Configurable via APPOINTMENT_REMINDER_LEAD_MS env var.
const DEFAULT_REMINDER_LEAD_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class AppointmentsService {
  private readonly logger = new Logger(AppointmentsService.name);
  private readonly reminderLeadMs: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly trustPolicies: TrustPoliciesService,
    private readonly config: ConfigService,
    @InjectQueue(APPOINTMENT_REMINDER_QUEUE)
    private readonly reminderQueue: Queue,
    private readonly notifications: NotificationsService,
  ) {
    this.reminderLeadMs = this.config.get<number>(
      'APPOINTMENT_REMINDER_LEAD_MS',
      DEFAULT_REMINDER_LEAD_MS,
    );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // PRIVATE HELPERS
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Resolve buyer profile via buyer_profiles.user_id.
   * OWNERSHIP RULE: never trust a raw buyer_id from the request.
   */
  private async resolveBuyerProfile(userId: string) {
    const profile = await this.prisma.buyerProfile.findUnique({ where: { userId } });
    if (!profile) throw new ForbiddenException('No buyer profile found for this account.');
    return profile;
  }

  /**
   * Resolve farmer profile via farmer_profiles.user_id.
   */
  private async resolveFarmerProfile(userId: string) {
    const profile = await this.prisma.farmerProfile.findUnique({ where: { userId } });
    if (!profile) throw new ForbiddenException('No farmer profile found for this account.');
    return profile;
  }

  /** Load an appointment and assert the caller is one of its two parties. */
  private async loadParticipantAppointment(
    appointmentId: string,
    userId: string,
  ): Promise<Appointment & { farmerProfileUserId: string; buyerProfileUserId: string }> {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        farmerProfile: { select: { userId: true } },
        buyerProfile:  { select: { userId: true } },
      },
    });
    if (!appt) throw new NotFoundException('Appointment not found');
    const farmerUserId = (appt as any).farmerProfile.userId as string;
    const buyerUserId  = (appt as any).buyerProfile.userId as string;
    if (farmerUserId !== userId && buyerUserId !== userId) {
      throw new ForbiddenException('You are not a participant of this appointment.');
    }
    return { ...appt, farmerProfileUserId: farmerUserId, buyerProfileUserId: buyerUserId };
  }

  /** Cancel the BullMQ reminder job for an appointment (best-effort). */
  private async cancelReminderJob(appointment: Appointment): Promise<void> {
    if (!appointment.reminderJobId) return;
    try {
      const job = await this.reminderQueue.getJob(appointment.reminderJobId);
      if (job) await job.remove();
    } catch (err) {
      this.logger.warn(
        `Could not remove reminder job ${appointment.reminderJobId}: ${(err as Error).message}`,
      );
    }
  }

  /** Schedule a BullMQ reminder job for a confirmed appointment. */
  private async scheduleReminderJob(appointment: Appointment): Promise<string | undefined> {
    const fireAt  = new Date(appointment.startTimeUtc).getTime() - this.reminderLeadMs;
    const delay   = fireAt - Date.now();
    if (delay <= 0) {
      this.logger.warn(`Appointment ${appointment.id} starts in < reminder window; no reminder scheduled.`);
      return undefined;
    }
    const jobId = `appt-reminder:${appointment.id}`;
    await this.reminderQueue.add(
      'send-reminder',
      {
        appointmentId:  appointment.id,
        farmerProfileId: appointment.farmerProfileId,
        buyerProfileId:  appointment.buyerProfileId,
        startTimeUtc:   appointment.startTimeUtc,
      },
      {
        delay,
        jobId,
        attempts:        3,
        backoff:         { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail:    false,
      },
    );
    this.logger.log(`Reminder scheduled for appointment ${appointment.id} at ${new Date(fireAt).toISOString()}`);
    return jobId;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE  (buyer requests an appointment)
  // ─────────────────────────────────────────────────────────────────────────

  async create(dto: CreateAppointmentDto, user: AuthenticatedUser): Promise<Appointment> {
    // Resolve buyer profile via user_id — never a raw ID shortcut
    const buyerProfile = await this.resolveBuyerProfile(user.sub);

    const start = new Date(dto.proposedStartUtc);
    const end   = new Date(dto.proposedEndUtc);
    if (end <= start) {
      throw new BadRequestException('end_time_utc must be after start_time_utc.');
    }
    if (start <= new Date()) {
      throw new BadRequestException('Appointment must be scheduled in the future.');
    }

    // Fetch farmer's timezone for storage
    const farmerProfile = await this.prisma.farmerProfile.findUnique({
      where: { id: dto.farmerProfileId },
      select: { id: true, timezone: true, userId: true },
    });
    if (!farmerProfile) throw new NotFoundException('Farmer profile not found.');
    if (farmerProfile.userId === user.sub) {
      throw new BadRequestException('Cannot book an appointment with yourself.');
    }

    // Fetch active trust policy for this farmer's region
    const farmerRegion = await this.prisma.farmerProfile.findUnique({
      where: { id: dto.farmerProfileId },
      select: { originRegionId: true },
    });
    const policy = await this.trustPolicies.getEffectivePolicy(farmerRegion?.originRegionId ?? null);

    // The DB EXCLUDE constraint will catch hard overlaps, but do a
    // soft pre-check here to return a friendlier error message.
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        farmerProfileId: dto.farmerProfileId,
        status: { in: ['REQUESTED', 'CONFIRMED'] },
        OR: [
          { startTimeUtc: { lt: end },   endTimeUtc: { gt: start } },
        ],
      },
      select: { id: true, startTimeUtc: true, endTimeUtc: true },
    });
    if (conflict) {
      throw new ConflictException(
        `Farmer already has an active appointment overlapping ` +
        `${start.toISOString()} — ${end.toISOString()}. ` +
        `Conflicting slot: ${conflict.startTimeUtc.toISOString()} — ${conflict.endTimeUtc.toISOString()}.`,
      );
    }

    const apptCreated = await this.prisma.appointment.create({
      data: {
        farmerProfileId:   dto.farmerProfileId,
        buyerProfileId:    buyerProfile.id,
        listingId:         dto.listingId ?? null,
        startTimeUtc:      start,
        endTimeUtc:        end,
        requesterTimezone: dto.requesterTimezone,
        farmerTimezone:    farmerProfile.timezone ?? 'UTC',
        notes:             dto.notes ?? null,
        status:            'REQUESTED',
        trustPolicyId:     policy.id === 'default' ? null : policy.id,
      },
    });

    // ── Notify farmer of new appointment request ──────────────────────────
    await this.notifications.enqueueAll(
      farmerProfile.userId,
      NotificationCategory.APPOINTMENT_REQUESTED,
      { appointmentId: apptCreated.id, buyerName: buyerProfile.id, startTimeUtc: start.toISOString() },
      `APPOINTMENT_REQUESTED:${apptCreated.id}`,
    );

    return apptCreated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESPOND  (farmer confirms or declines)
  // ─────────────────────────────────────────────────────────────────────────

  async respond(
    appointmentId: string,
    dto: RespondAppointmentDto,
    user: AuthenticatedUser,
  ): Promise<Appointment> {
    const appt = await this.loadParticipantAppointment(appointmentId, user.sub);

    // Only the farmer may respond
    if (appt.farmerProfileUserId !== user.sub) {
      throw new ForbiddenException('Only the farmer can confirm or decline an appointment request.');
    }
    if (appt.status !== 'REQUESTED') {
      throw new BadRequestException(`Cannot respond to an appointment with status '${appt.status}'.`);
    }

    if (dto.action === AppointmentRespondAction.DECLINE) {
      const cancelled = await this.prisma.appointment.update({
        where: { id: appointmentId },
        data:  { status: 'CANCELLED', updatedAt: new Date() },
      });
      // Notify buyer of cancellation
      const buyerUserId = await this.prisma.buyerProfile.findUnique({ where: { id: appt.buyerProfileId }, select: { userId: true } });
      if (buyerUserId?.userId) {
        await this.notifications.enqueueAll(
          buyerUserId.userId, NotificationCategory.APPOINTMENT_CANCELLED,
          { appointmentId, farmerProfileId: appt.farmerProfileId, startTimeUtc: appt.startTimeUtc.toISOString() },
          `APPOINTMENT_CANCELLED:${appointmentId}`,
        );
      }
      return cancelled;
    }

    // CONFIRM: update status, then schedule reminder
    const confirmed = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data: {
        status:         'CONFIRMED',
        farmerTimezone: dto.farmerTimezone ?? appt.farmerTimezone ?? 'UTC',
        updatedAt:      new Date(),
      },
    });

    const jobId = await this.scheduleReminderJob(confirmed);
    if (jobId) {
      await this.prisma.appointment.update({
        where: { id: appointmentId },
        data:  { reminderJobId: jobId },
      });
      confirmed.reminderJobId = jobId;
    }

    // ── Notify buyer of confirmation ──────────────────────────────────
    const buyerForNotif = await this.prisma.buyerProfile.findUnique({ where: { id: appt.buyerProfileId }, select: { userId: true } });
    if (buyerForNotif?.userId) {
      await this.notifications.enqueueAll(
        buyerForNotif.userId, NotificationCategory.APPOINTMENT_CONFIRMED,
        { appointmentId, farmerProfileId: appt.farmerProfileId, startTimeUtc: confirmed.startTimeUtc.toISOString() },
        `APPOINTMENT_CONFIRMED:${appointmentId}`,
      );
    }

    return confirmed;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPLETE
  // CRITICAL: Only COMPLETED satisfies the trust-gate for checkout.
  //           isAppointmentCompleted() is intentionally named to prevent
  //           Module 4 from accidentally calling isAppointmentConfirmed().
  // ─────────────────────────────────────────────────────────────────────────

  async complete(
    appointmentId: string,
    dto: CompleteAppointmentDto,
    user: AuthenticatedUser,
  ): Promise<Appointment> {
    const appt = await this.loadParticipantAppointment(appointmentId, user.sub);

    if (appt.farmerProfileUserId !== user.sub) {
      throw new ForbiddenException('Only the farmer can mark an appointment as completed.');
    }
    if (appt.status !== 'CONFIRMED') {
      throw new BadRequestException(`Cannot complete an appointment with status '${appt.status}'.`);
    }
    if (new Date() < appt.startTimeUtc) {
      throw new BadRequestException('Cannot mark an appointment as completed before its start time.');
    }

    // Cancel reminder (already fired or no longer needed)
    await this.cancelReminderJob(appt);

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data:  { status: 'COMPLETED', updatedAt: new Date() },
    });
  }

  /**
   * Trust-gate check for Module 4 (Orders).
   *
   * INTENTIONALLY named isAppointmentCompleted() — NOT isAppointmentConfirmed().
   * Only status='COMPLETED' satisfies the trust gate.
   * 'CONFIRMED' alone is NOT sufficient.
   *
   * Called by OrdersService before allowing checkout:
   *   const gate = await appointmentsService.isAppointmentCompleted({ farmerProfileId, buyerProfileId })
   *   if (gate.required && !gate.completed) throw ForbiddenException(...)
   */
  async isAppointmentCompleted(args: {
    farmerProfileId: string;
    buyerProfileId:  string;
    orderValueAmount: number;
    regionId: string | null;
  }): Promise<{ required: boolean; completed: boolean; reason?: string }> {
    const { required, reason } = await this.trustPolicies.isAppointmentRequiredForOrder(args);
    if (!required) return { required: false, completed: false };

    const completed = await this.prisma.appointment.findFirst({
      where: {
        farmerProfileId: args.farmerProfileId,
        buyerProfileId:  args.buyerProfileId,
        status:          'COMPLETED', // only COMPLETED counts
      },
      select: { id: true },
    });

    return { required: true, completed: !!completed, reason };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NO-SHOW
  // ─────────────────────────────────────────────────────────────────────────

  async markNoShow(
    appointmentId: string,
    dto: MarkNoShowDto,
    user: AuthenticatedUser,
  ): Promise<Appointment> {
    const appt = await this.loadParticipantAppointment(appointmentId, user.sub);

    if (appt.status !== 'CONFIRMED') {
      throw new BadRequestException(
        `Can only flag a no-show on a CONFIRMED appointment (current: '${appt.status}').`,
      );
    }
    if (new Date() < appt.startTimeUtc) {
      throw new BadRequestException('Cannot flag a no-show before the appointment\'s start time.');
    }

    // Derive which party is flagged from who is calling
    const isCaller_farmer = appt.farmerProfileUserId === user.sub;
    const noShowParty: 'FARMER' | 'BUYER' = isCaller_farmer ? 'BUYER' : 'FARMER';

    // Cancel reminder (no longer relevant)
    await this.cancelReminderJob(appt);

    const updated = await this.prisma.appointment.update({
      where: { id: appointmentId },
      data:  { status: 'NO_SHOW', noShowParty, updatedAt: new Date() },
    });

    // Increment no_show_count on the flagged profile
    let newNoShowCount: number;
    let regionId: string | null = null;

    if (noShowParty === 'BUYER') {
      const buyer = await this.prisma.buyerProfile.update({
        where: { id: appt.buyerProfileId },
        data:  { noShowCount: { increment: 1 } },
        select: { noShowCount: true },
      });
      newNoShowCount = buyer.noShowCount;
    } else {
      const farmer = await this.prisma.farmerProfile.update({
        where: { id: appt.farmerProfileId },
        data:  { noShowCount: { increment: 1 } },
        select: { noShowCount: true, originRegionId: true },
      });
      newNoShowCount = farmer.noShowCount;
      regionId = farmer.originRegionId;
    }

    // Check threshold and write audit flag if breached (no auto-suspend)
    const breached = await this.trustPolicies.isNoShowThresholdBreached({
      noShowCount: newNoShowCount,
      regionId,
    });

    if (breached) {
      this.logger.warn(
        `no_show_count threshold breached for ${noShowParty} profile ` +
        `${noShowParty === 'BUYER' ? appt.buyerProfileId : appt.farmerProfileId}. Writing audit flag.`,
      );
      await this.prisma.auditLog.create({
        data: {
          actorUserId: user.sub,
          action:      'no_show:threshold_breached:review_flagged',
          targetType:  noShowParty === 'BUYER' ? 'buyer_profile' : 'farmer_profile',
          targetId:    noShowParty === 'BUYER' ? appt.buyerProfileId : appt.farmerProfileId,
          metadata: {
            appointmentId,
            noShowParty,
            noShowCount: newNoShowCount,
            note: dto.note ?? null,
            // DOES NOT auto-suspend — regional admin must review
          },
        },
      });
    }

    return updated;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESCHEDULE
  // ─────────────────────────────────────────────────────────────────────────

  async reschedule(
    appointmentId: string,
    dto: RescheduleAppointmentDto,
    user: AuthenticatedUser,
  ): Promise<Appointment> {
    const appt = await this.loadParticipantAppointment(appointmentId, user.sub);

    if (!['REQUESTED', 'CONFIRMED'].includes(appt.status)) {
      throw new BadRequestException(
        `Cannot reschedule an appointment with status '${appt.status}'.`,
      );
    }

    const newStart = new Date(dto.newStartUtc);
    const newEnd   = new Date(dto.newEndUtc);
    if (newEnd <= newStart) throw new BadRequestException('newEndUtc must be after newStartUtc.');
    if (newStart <= new Date()) throw new BadRequestException('New slot must be in the future.');

    // Pre-check for overlap on the new slot
    const conflict = await this.prisma.appointment.findFirst({
      where: {
        farmerProfileId: appt.farmerProfileId,
        status: { in: ['REQUESTED', 'CONFIRMED'] },
        id:     { not: appointmentId }, // exclude self
        OR: [{ startTimeUtc: { lt: newEnd }, endTimeUtc: { gt: newStart } }],
      },
      select: { id: true, startTimeUtc: true, endTimeUtc: true },
    });
    if (conflict) {
      throw new ConflictException(
        `New slot overlaps an existing active appointment for this farmer. ` +
        `Conflicting: ${conflict.startTimeUtc.toISOString()} — ${conflict.endTimeUtc.toISOString()}.`,
      );
    }

    // Cancel existing reminder BEFORE we change the old appointment
    await this.cancelReminderJob(appt);

    // Mark old appointment as RESCHEDULED and create a new REQUESTED one
    const [, newAppt] = await this.prisma.$transaction([
      this.prisma.appointment.update({
        where: { id: appointmentId },
        data:  { status: 'RESCHEDULED', updatedAt: new Date() },
      }),
      this.prisma.appointment.create({
        data: {
          farmerProfileId:   appt.farmerProfileId,
          buyerProfileId:    appt.buyerProfileId,
          listingId:         appt.listingId,
          startTimeUtc:      newStart,
          endTimeUtc:        newEnd,
          requesterTimezone: dto.requesterTimezone,
          farmerTimezone:    appt.farmerTimezone ?? 'UTC',
          notes:             dto.reason ?? appt.notes,
          status:            'REQUESTED',
          trustPolicyId:     appt.trustPolicyId,
        },
      }),
    ]);

    // Link old row → new row
    await this.prisma.appointment.update({
      where: { id: appointmentId },
      data:  { rescheduledToId: newAppt.id },
    });

    // Reminder for new appointment will be scheduled when farmer confirms it
    return newAppt;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CANCEL
  // ─────────────────────────────────────────────────────────────────────────

  async cancel(
    appointmentId: string,
    user: AuthenticatedUser,
  ): Promise<Appointment> {
    const appt = await this.loadParticipantAppointment(appointmentId, user.sub);

    if (!['REQUESTED', 'CONFIRMED'].includes(appt.status)) {
      throw new BadRequestException(`Cannot cancel an appointment with status '${appt.status}'.`);
    }

    // Cancel reminder if present
    await this.cancelReminderJob(appt);

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data:  { status: 'CANCELLED', updatedAt: new Date() },
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────────────────────

  async findOne(appointmentId: string, user: AuthenticatedUser): Promise<Appointment> {
    return this.loadParticipantAppointment(appointmentId, user.sub);
  }

  async findMyAppointments(user: AuthenticatedUser) {
    // Return all appointments where the caller is farmer OR buyer
    const farmerProfile = await this.prisma.farmerProfile.findUnique({ where: { userId: user.sub }, select: { id: true } });
    const buyerProfile  = await this.prisma.buyerProfile.findUnique({  where: { userId: user.sub }, select: { id: true } });

    const profileIds: { farmerProfileId?: string; buyerProfileId?: string }[] = [];
    if (farmerProfile) profileIds.push({ farmerProfileId: farmerProfile.id });
    if (buyerProfile)  profileIds.push({ buyerProfileId:  buyerProfile.id  });

    if (!profileIds.length) throw new ForbiddenException('No profile found for this account.');

    return this.prisma.appointment.findMany({
      where: { OR: profileIds },
      orderBy: { startTimeUtc: 'asc' },
      include: {
        listing: { select: { id: true, title: true } },
      },
    });
  }
}
