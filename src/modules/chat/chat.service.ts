import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  ConflictException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * ChatService
 *
 * Chat threads are scoped strictly to a single order OR appointment.
 * There are NO open DMs.
 *
 * Constraints (enforced by both DB and service):
 *   - One thread per order (UNIQUE order_id)
 *   - One thread per appointment (UNIQUE appointment_id)
 *   - Exactly one of order_id / appointment_id must be set (DB CHECK constraint)
 *
 * A dispute can reference a chat thread for context via disputes.related_chat_thread_id,
 * but disputes do NOT create new threads.
 *
 * Participant access:
 *   - Order threads: farmer + buyer on that order, plus SUPPORT_MODERATOR+
 *   - Appointment threads: farmer + buyer on that appointment, plus SUPPORT_MODERATOR+
 *
 * Soft delete: messages are soft-deleted (is_deleted=true, deleted_at set).
 * The body is NOT nulled on soft delete (to support audit). Only moderators
 * can see soft-deleted messages.
 */
@Injectable()
export class ChatService {
  private readonly logger = new Logger(ChatService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── THREADS ────────────────────────────────────────────────────────────

  /**
   * getOrCreateThreadForOrder
   * Idempotent: if a thread already exists for this order, returns it.
   * One thread per order max (UNIQUE constraint).
   */
  async getOrCreateThreadForOrder(orderId: string, subject?: string) {
    // Verify order exists
    const order = await this.prisma.order.findUnique({ where: { id: orderId } });
    if (!order) throw new NotFoundException(`Order ${orderId} not found.`);

    const existing = await this.prisma.chatThread.findUnique({ where: { orderId } });
    if (existing) return existing;

    return this.prisma.chatThread.create({
      data: { orderId, appointmentId: null, subject: subject ?? null },
    });
  }

  /**
   * getOrCreateThreadForAppointment
   * Idempotent: if a thread already exists for this appointment, returns it.
   * One thread per appointment max (UNIQUE constraint).
   */
  async getOrCreateThreadForAppointment(appointmentId: string, subject?: string) {
    const appt = await this.prisma.appointment.findUnique({ where: { id: appointmentId } });
    if (!appt) throw new NotFoundException(`Appointment ${appointmentId} not found.`);

    const existing = await this.prisma.chatThread.findUnique({ where: { appointmentId } });
    if (existing) return existing;

    return this.prisma.chatThread.create({
      data: { orderId: null, appointmentId, subject: subject ?? null },
    });
  }

  async loadThread(threadId: string) {
    const t = await this.prisma.chatThread.findUnique({ where: { id: threadId } });
    if (!t) throw new NotFoundException(`Chat thread ${threadId} not found.`);
    return t;
  }

  async archiveThread(threadId: string) {
    const t = await this.loadThread(threadId);
    return this.prisma.chatThread.update({ where: { id: threadId }, data: { isArchived: true } });
  }

  // ─── MESSAGES ───────────────────────────────────────────────────────────

  /**
   * sendMessage
   * @param senderUserId - Must be a participant on the thread\'s order/appointment
   *   or a SUPPORT_MODERATOR+ (access check done at controller layer)
   */
  async sendMessage(
    threadId:     string,
    senderUserId: string,
    body:         string,
    attachment?:  { s3Key: string; mimeType: string },
  ) {
    const thread = await this.loadThread(threadId);
    if (thread.isArchived) {
      throw new BadRequestException('Cannot send messages to an archived chat thread.');
    }

    return this.prisma.chatMessage.create({
      data: {
        threadId,
        senderUserId,
        body,
        s3Key:    attachment?.s3Key    ?? null,
        mimeType: attachment?.mimeType ?? null,
      },
    });
  }

  /**
   * listMessages
   * @param includeDeleted - Only SUPPORT_MODERATOR+ should pass true
   */
  async listMessages(threadId: string, includeDeleted = false) {
    await this.loadThread(threadId); // validate thread exists
    return this.prisma.chatMessage.findMany({
      where:   includeDeleted ? { threadId } : { threadId, isDeleted: false },
      orderBy: { createdAt: 'asc' },
    });
  }

  /**
   * softDeleteMessage
   * Soft delete only — body preserved for audit.
   * @param actorUserId - Must be the sender OR SUPPORT_MODERATOR+
   */
  async softDeleteMessage(messageId: string, actorUserId: string, actorIsModerator: boolean) {
    const msg = await this.prisma.chatMessage.findUnique({ where: { id: messageId } });
    if (!msg) throw new NotFoundException(`Message ${messageId} not found.`);
    if (msg.isDeleted) throw new BadRequestException('Message is already deleted.');

    if (!actorIsModerator && msg.senderUserId !== actorUserId) {
      throw new ForbiddenException('You can only delete your own messages.');
    }

    return this.prisma.chatMessage.update({
      where: { id: messageId },
      data:  { isDeleted: true, deletedAt: new Date() },
    });
  }

  // ─── ACCESS CHECK HELPERS (called by controller) ─────────────────────────────

  /**
   * assertUserIsParticipant
   * Throws ForbiddenException if the user is not a participant on the thread\'s scope.
   * Skip this check for SUPPORT_MODERATOR+ (caller decides).
   */
  async assertUserIsParticipant(threadId: string, userId: string): Promise<void> {
    const thread = await this.loadThread(threadId);

    if (thread.orderId) {
      const order = await this.prisma.order.findUnique({ where: { id: thread.orderId } });
      if (!order) throw new NotFoundException('Thread order not found.');

      const farmer = await this.prisma.farmerProfile.findUnique({ where: { userId } });
      const buyer  = await this.prisma.buyerProfile.findUnique({ where: { userId } });

      const isFarmerOnOrder = farmer && farmer.id === order.farmerProfileId;
      const isBuyerOnOrder  = buyer  && buyer.id  === order.buyerProfileId;

      if (!isFarmerOnOrder && !isBuyerOnOrder) {
        throw new ForbiddenException('You are not a participant on this order chat thread.');
      }
      return;
    }

    if (thread.appointmentId) {
      const appt = await this.prisma.appointment.findUnique({ where: { id: thread.appointmentId } });
      if (!appt) throw new NotFoundException('Thread appointment not found.');

      const farmer = await this.prisma.farmerProfile.findUnique({ where: { userId } });
      const buyer  = await this.prisma.buyerProfile.findUnique({ where: { userId } });

      const isFarmerOnAppt = farmer && farmer.id === appt.farmerProfileId;
      const isBuyerOnAppt  = buyer  && buyer.id  === appt.buyerProfileId;

      if (!isFarmerOnAppt && !isBuyerOnAppt) {
        throw new ForbiddenException('You are not a participant on this appointment chat thread.');
      }
    }
  }
}
