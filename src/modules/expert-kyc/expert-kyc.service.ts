import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { VerificationStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

export interface UploadKycInput {
  /** Authenticated user id (from req.user.sub — never the request body). */
  userId: string;
  documentType: string;
  file: Express.Multer.File;
}

@Injectable()
export class ExpertKycService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Store a credential document for the authenticated expert and (re)mark their
   * profile PENDING so a human review is required after every new upload.
   */
  async uploadKycDocument(input: UploadKycInput) {
    // Resolve the expert profile from the token identity, not the request body.
    const expertProfile = await this.prisma.expertProfile.findUnique({
      where: { userId: input.userId },
      select: { id: true },
    });

    if (!expertProfile) {
      throw new NotFoundException('Expert profile not found for this user.');
    }

    // Simulate an S3 upload — swap for a real StorageService later.
    const documentUrl = this.simulateS3Upload(expertProfile.id, input.file);

    // Persist the document and reset the profile to PENDING atomically.
    const [document] = await this.prisma.$transaction([
      this.prisma.expertKycDocument.create({
        data: {
          expertProfile: { connect: { id: expertProfile.id } },
          documentUrl,
          documentType: input.documentType,
        },
      }),
      this.prisma.expertProfile.update({
        where: { id: expertProfile.id },
        data: { verificationStatus: VerificationStatus.PENDING },
      }),
    ]);

    return { document, verificationStatus: VerificationStatus.PENDING };
  }

  // ─── Admin moderation ──────────────────────────────────────────────

  /** All KYC submissions still awaiting a human decision, oldest first. */
  async findPendingSubmissions() {
    return this.prisma.expertKycDocument.findMany({
      where: { status: VerificationStatus.PENDING },
      orderBy: { uploadedAt: 'asc' },
      include: {
        expertProfile: {
          select: {
            id: true,
            displayName: true,
            specialization: true,
            verificationStatus: true,
            userId: true,
          },
        },
      },
    });
  }

  /**
   * Admin verdict on one submission. Updates the document (status + notes +
   * reviewer + timestamp) AND the parent ExpertProfile.verificationStatus in a
   * single transaction so a document is never marked reviewed while its profile
   * lags behind (or vice-versa).
   */
  async reviewKycDocument(input: {
    documentId: string;
    status: VerificationStatus;
    reviewNotes?: string;
    reviewerId: string;
  }) {
    const document = await this.prisma.expertKycDocument.findUnique({
      where: { id: input.documentId },
      select: { id: true, expertProfileId: true },
    });
    if (!document) {
      throw new NotFoundException(`KYC document ${input.documentId} not found.`);
    }

    const [reviewedDocument, expertProfile] = await this.prisma.$transaction([
      this.prisma.expertKycDocument.update({
        where: { id: document.id },
        data: {
          status: input.status,
          reviewNotes: input.reviewNotes ?? null,
          reviewedBy: input.reviewerId,
          reviewedAt: new Date(),
        },
      }),
      this.prisma.expertProfile.update({
        where: { id: document.expertProfileId },
        data: { verificationStatus: input.status },
      }),
    ]);

    return { document: reviewedDocument, verificationStatus: expertProfile.verificationStatus };
  }

  /** Mock object-storage upload — returns a stand-in URL, no real network I/O. */
  private simulateS3Upload(expertProfileId: string, file: Express.Multer.File): string {
    const safeName = (file.originalname ?? 'document').replace(/[^\w.-]/g, '_');
    return `https://s3.mock.local/expert-kyc/${expertProfileId}/${randomUUID()}-${safeName}`;
  }
}
