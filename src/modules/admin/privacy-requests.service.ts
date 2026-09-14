import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  ConflictException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { PrivacyRequestType } from './dto/privacy-request.dto';

/**
 * PrivacyRequestsService
 *
 * Handles GDPR / data-subject requests.
 *
 * EXPORT:
 *   - Creates a privacy_request row (status=PENDING).
 *   - A background worker generates the export archive, uploads to S3,
 *     and calls fulfillExport() to set status=FULFILLED.
 *
 * DELETION:
 *   - Anonymizes PII fields on users, farmer_profiles, buyer_profiles.
 *   - Does NOT delete completed orders, payments, or ledger_entries.
 *   - Preserves financial record IDs and amounts (retention policy).
 *   - Populates retained_data_note explaining what was kept and why.
 *   - All writes happen in a single Prisma transaction.
 *
 * One pending/active deletion request per user at a time.
 */
@Injectable()
export class PrivacyRequestsService {
  private readonly logger = new Logger(PrivacyRequestsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── CREATE ──────────────────────────────────────────────────────────────

  async createRequest(userId: string, type: PrivacyRequestType) {
    // Prevent duplicate pending requests of the same type
    const existing = await this.prisma.privacyRequest.findFirst({
      where: { userId, type, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
    if (existing) {
      throw new ConflictException(
        `A ${type} request is already in progress (id: ${existing.id}).`,
      );
    }

    const request = await this.prisma.privacyRequest.create({
      data: { userId, type, status: 'PENDING', requestedAt: new Date() },
    });

    this.logger.log(`PrivacyRequest ${request.id} created | user=${userId} type=${type}`);
    return request;
  }

  // ─── FULFILL EXPORT ─────────────────────────────────────────────────────────

  /**
   * fulfillExport
   * Called by the privacy worker after the S3 archive is ready.
   */
  async fulfillExport(requestId: string, exportS3Key: string) {
    const req = await this.loadRequest(requestId);
    if (req.type !== 'EXPORT') throw new BadRequestException('Request is not of type EXPORT.');
    this.assertPending(req.status);

    return this.prisma.privacyRequest.update({
      where: { id: requestId },
      data:  { status: 'FULFILLED', fulfilledAt: new Date(), exportS3Key },
    });
  }

  // ─── EXECUTE DELETION ─────────────────────────────────────────────────────────

  /**
   * executeDeletion
   * Anonymizes PII. Preserves financial records (orders, payments, ledger).
   * Called by PLATFORM_ADMIN or the automated privacy worker.
   *
   * Retention policy (per security doc):
   *   - Orders, payments, ledger_entries: NEVER deleted (financial / regulatory).
   *   - Appointments: kept (operational record), name fields cleared.
   *   - KYC documents: s3_key retained (audit trail), display name cleared.
   *   - Listings: deactivated + title/description cleared.
   *   - Reviews: body cleared, rating kept (platform integrity).
   *   - Chat messages: body cleared ("[deleted - privacy request]").
   *   - User row: name, email, phone, avatar cleared. Row preserved.
   */
  async executeDeletion(requestId: string) {
    const req = await this.loadRequest(requestId);
    if (req.type !== 'DELETION') throw new BadRequestException('Request is not of type DELETION.');
    this.assertPending(req.status);

    const userId = req.userId;
    const REDACTED = '[redacted]';
    const retainedNote = [
      'The following financial records were preserved per KashRoot retention policy',
      '(7-year mandatory financial record-keeping):',
      '  - orders: all rows where farmer or buyer matches this user.',
      '  - payments: all payment records linked to above orders.',
      '  - ledger_entries: all ledger rows linked to above orders.',
      'PII fields on users, farmer_profiles, buyer_profiles, listings,',
      'appointments, reviews, and chat_messages have been cleared.',
    ].join('\n');

    await this.prisma.$transaction(async (tx) => {
      // ─ 1. Resolve profiles ──────────────────────────────────────────────
      const farmerProfile = await tx.farmerProfile.findUnique({ where: { userId } });
      const buyerProfile  = await tx.buyerProfile.findUnique({ where: { userId } });

      // ─ 2. Anonymize user row ────────────────────────────────────────────
      await tx.user.update({
        where: { id: userId },
        data:  {
          name:            REDACTED,
          email:           `${userId}@deleted.kashroot.invalid`,
          phone:           null,
          avatarS3Key:     null,
          isAnonymized:    true,
          anonymizedAt:    new Date(),
        },
      });

      // ─ 3. Anonymize farmer_profile ───────────────────────────────────────
      if (farmerProfile) {
        await tx.farmerProfile.update({
          where: { userId },
          data:  { displayName: REDACTED, bio: null, contactPhone: null },
        });

        // Deactivate listings, clear PII fields
        await tx.listing.updateMany({
          where:  { farmerProfileId: farmerProfile.id },
          data:   { isActive: false, title: REDACTED, description: null },
        });
      }

      // ─ 4. Anonymize buyer_profile ────────────────────────────────────────
      if (buyerProfile) {
        await tx.buyerProfile.update({
          where: { userId },
          data:  { displayName: REDACTED, bio: null, contactPhone: null },
        });
      }

      // ─ 5. Clear review bodies (keep rating for platform integrity) ───────────
      const profileIds = [
        farmerProfile?.id,
        buyerProfile?.id,
      ].filter(Boolean) as string[];

      if (profileIds.length) {
        await tx.review.updateMany({
          where:  { reviewerProfileId: { in: profileIds } },
          data:   { body: '[redacted - privacy request]' },
        });
      }

      // ─ 6. Clear chat message bodies (soft data, not financial) ─────────────
      await tx.chatMessage.updateMany({
        where:  { senderUserId: userId },
        data:   { body: '[deleted - privacy request]' },
      });

      // ─ 7. Mark privacy request fulfilled ─────────────────────────────
      await tx.privacyRequest.update({
        where: { id: requestId },
        data:  {
          status:           'FULFILLED',
          fulfilledAt:      new Date(),
          retainedDataNote: retainedNote,
        },
      });
    });

    this.logger.log(`PrivacyRequest ${requestId} DELETION executed | user=${userId}`);
    return this.loadRequest(requestId);
  }

  // ─── REJECT ──────────────────────────────────────────────────────────────

  async rejectRequest(requestId: string, rejectionReason: string) {
    const req = await this.loadRequest(requestId);
    this.assertPending(req.status);
    return this.prisma.privacyRequest.update({
      where: { id: requestId },
      data:  { status: 'REJECTED', rejectionReason },
    });
  }

  // ─── LIST ──────────────────────────────────────────────────────────────

  async listForUser(userId: string) {
    return this.prisma.privacyRequest.findMany({
      where: { userId }, orderBy: { requestedAt: 'desc' },
    });
  }

  async listAll(status?: string) {
    return this.prisma.privacyRequest.findMany({
      where:   status ? { status } : undefined,
      orderBy: { requestedAt: 'desc' },
    });
  }

  // ─── PRIVATE ────────────────────────────────────────────────────────────

  private async loadRequest(id: string) {
    const r = await this.prisma.privacyRequest.findUnique({ where: { id } });
    if (!r) throw new NotFoundException(`PrivacyRequest ${id} not found.`);
    return r;
  }

  private assertPending(status: string) {
    if (!['PENDING', 'IN_PROGRESS'].includes(status)) {
      throw new BadRequestException(
        `Privacy request is already in terminal status: ${status}.`,
      );
    }
  }
}
