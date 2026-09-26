import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { VerificationStatus } from '@prisma/client';

import { ExpertKycService } from './expert-kyc.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('ExpertKycService (admin moderation)', () => {
  let service: ExpertKycService;

  const mockPrisma = {
    expertKycDocument: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    expertProfile: { update: jest.fn() },
    // Array form: resolve each operation the service enqueued.
    $transaction: jest.fn((ops: Promise<unknown>[]) => Promise.all(ops)),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ExpertKycService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<ExpertKycService>(ExpertKycService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('findPendingSubmissions', () => {
    it('queries only PENDING documents, oldest first, with the profile', async () => {
      mockPrisma.expertKycDocument.findMany.mockResolvedValue([{ id: 'doc-1' }]);

      const result = await service.findPendingSubmissions();

      expect(mockPrisma.expertKycDocument.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: VerificationStatus.PENDING },
          orderBy: { uploadedAt: 'asc' },
          include: expect.objectContaining({ expertProfile: expect.anything() }),
        }),
      );
      expect(result).toEqual([{ id: 'doc-1' }]);
    });
  });

  describe('reviewKycDocument', () => {
    it('VERIFIED: updates the document and cascades to the parent profile', async () => {
      mockPrisma.expertKycDocument.findUnique.mockResolvedValue({
        id: 'doc-1',
        expertProfileId: 'exp-1',
      });
      mockPrisma.expertKycDocument.update.mockResolvedValue({
        id: 'doc-1',
        status: VerificationStatus.VERIFIED,
      });
      mockPrisma.expertProfile.update.mockResolvedValue({
        verificationStatus: VerificationStatus.VERIFIED,
      });

      const result = await service.reviewKycDocument({
        documentId: 'doc-1',
        status: VerificationStatus.VERIFIED,
        reviewNotes: 'Credentials confirmed',
        reviewerId: 'admin-1',
      });

      expect(mockPrisma.expertKycDocument.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'doc-1' },
          data: expect.objectContaining({
            status: VerificationStatus.VERIFIED,
            reviewNotes: 'Credentials confirmed',
            reviewedBy: 'admin-1',
            reviewedAt: expect.any(Date),
          }),
        }),
      );
      expect(mockPrisma.expertProfile.update).toHaveBeenCalledWith({
        where: { id: 'exp-1' },
        data: { verificationStatus: VerificationStatus.VERIFIED },
      });
      expect(result.verificationStatus).toBe(VerificationStatus.VERIFIED);
    });

    it('REJECTED: propagates the rejection to the profile', async () => {
      mockPrisma.expertKycDocument.findUnique.mockResolvedValue({
        id: 'doc-2',
        expertProfileId: 'exp-2',
      });
      mockPrisma.expertKycDocument.update.mockResolvedValue({ id: 'doc-2' });
      mockPrisma.expertProfile.update.mockResolvedValue({
        verificationStatus: VerificationStatus.REJECTED,
      });

      const result = await service.reviewKycDocument({
        documentId: 'doc-2',
        status: VerificationStatus.REJECTED,
        reviewerId: 'admin-1',
      });

      expect(mockPrisma.expertProfile.update).toHaveBeenCalledWith({
        where: { id: 'exp-2' },
        data: { verificationStatus: VerificationStatus.REJECTED },
      });
      expect(result.verificationStatus).toBe(VerificationStatus.REJECTED);
    });

    it('throws NotFound for an unknown document and writes nothing', async () => {
      mockPrisma.expertKycDocument.findUnique.mockResolvedValue(null);

      await expect(
        service.reviewKycDocument({
          documentId: 'missing',
          status: VerificationStatus.VERIFIED,
          reviewerId: 'admin-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.expertKycDocument.update).not.toHaveBeenCalled();
      expect(mockPrisma.expertProfile.update).not.toHaveBeenCalled();
    });
  });
});
