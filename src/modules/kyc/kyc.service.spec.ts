import { Test, TestingModule } from '@nestjs/testing';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycIdentityMethod, VerificationStatus } from '@prisma/client';

import { KycService } from './kyc.service';
import { PrismaService } from '../../prisma/prisma.service';
import { FieldEncryptionService } from '../../common/utils/field-encryption.service';
import { CreateKycSubmissionDto } from './dto/create-kyc-submission.dto';
import {
  IDENTITY_VERIFICATION_PROVIDER,
  IdentityVerificationProvider,
  OtpRejectedError,
} from './providers/identity-verification.provider';

/** A real 32-byte key, so encryption is exercised rather than stubbed. */
const TEST_KEY = 'a'.repeat(64);

/** Verhoeff-valid; the service rejects anything else before the provider sees it. */
const VALID_AADHAAR = '999941057058';

function submissionDto(overrides: Partial<CreateKycSubmissionDto> = {}): CreateKycSubmissionDto {
  return {
    role: 'SELLER',
    identity: {
      method: KycIdentityMethod.AADHAAR_OTP,
      referenceId: 'sandbox-otp-abc123',
      aadhaarLast4: '7058',
      pan: 'ABCPK1234L',
    },
    bank: {
      ifsc: 'JAKA0SRINAG',
      bankName: 'Jammu & Kashmir Bank',
      branch: 'Srinagar Main',
      accountNumber: '001234567890',
    },
    ...overrides,
  } as CreateKycSubmissionDto;
}

describe('KycService', () => {
  let service: KycService;
  let encryption: FieldEncryptionService;

  const mockPrisma = {
    kycSubmission: {
      create: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };

  const mockProvider: jest.Mocked<IdentityVerificationProvider> = {
    name: 'test',
    requestAadhaarOtp: jest.fn(),
    verifyAadhaarOtp: jest.fn(),
    startDigiLocker: jest.fn(),
    completeDigiLocker: jest.fn(),
  } as unknown as jest.Mocked<IdentityVerificationProvider>;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        KycService,
        FieldEncryptionService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: IDENTITY_VERIFICATION_PROVIDER, useValue: mockProvider },
        { provide: ConfigService, useValue: { get: () => TEST_KEY } },
      ],
    }).compile();

    service = module.get(KycService);
    encryption = module.get(FieldEncryptionService);
    mockPrisma.kycSubmission.findFirst.mockResolvedValue(null);
  });

  afterEach(() => jest.clearAllMocks());

  describe('createSubmission', () => {
    it('encrypts the account number and stores only its last four digits in clear', async () => {
      mockPrisma.kycSubmission.create.mockResolvedValue({ id: 'kyc-1' });

      await service.createSubmission({
        userId: 'user-1',
        userRoles: ['SELLER'],
        dto: submissionDto(),
      });

      const { data } = mockPrisma.kycSubmission.create.mock.calls[0][0];

      expect(data.accountNumberEnc).toBeInstanceOf(Buffer);
      expect(data.accountNumberLast4).toBe('7890');
      // The plaintext must not survive anywhere in the written row.
      expect(JSON.stringify(data)).not.toContain('001234567890');
      // ...and what was written must decrypt back to it.
      expect(encryption.decrypt(data.accountNumberEnc)).toBe('001234567890');
    });

    it('never stores a full Aadhaar number, only the last four digits', async () => {
      mockPrisma.kycSubmission.create.mockResolvedValue({ id: 'kyc-1' });

      await service.createSubmission({
        userId: 'user-1',
        userRoles: ['SELLER'],
        dto: submissionDto(),
      });

      const { data } = mockPrisma.kycSubmission.create.mock.calls[0][0];
      expect(data.aadhaarLast4).toBe('7058');
      expect(data.referenceId).toBe('sandbox-otp-abc123');
      expect(Object.keys(data)).not.toContain('aadhaarNumber');
    });

    it('takes the user id from the token, not the payload', async () => {
      mockPrisma.kycSubmission.create.mockResolvedValue({ id: 'kyc-1' });

      await service.createSubmission({
        userId: 'user-from-token',
        userRoles: ['FARMER'],
        dto: submissionDto({ role: 'FARMER' }),
      });

      const { data } = mockPrisma.kycSubmission.create.mock.calls[0][0];
      expect(data.user).toEqual({ connect: { id: 'user-from-token' } });
    });

    it('normalises PAN and IFSC to upper case', async () => {
      mockPrisma.kycSubmission.create.mockResolvedValue({ id: 'kyc-1' });

      await service.createSubmission({
        userId: 'user-1',
        userRoles: ['SELLER'],
        dto: submissionDto(),
      });

      const { data } = mockPrisma.kycSubmission.create.mock.calls[0][0];
      expect(data.pan).toBe('ABCPK1234L');
      expect(data.ifsc).toBe('JAKA0SRINAG');
    });

    it('never selects the encrypted account number back out', async () => {
      mockPrisma.kycSubmission.create.mockResolvedValue({ id: 'kyc-1' });

      await service.createSubmission({
        userId: 'user-1',
        userRoles: ['SELLER'],
        dto: submissionDto(),
      });

      const { select } = mockPrisma.kycSubmission.create.mock.calls[0][0];
      expect(select.accountNumberEnc).toBeUndefined();
      expect(select.accountNumberLast4).toBe(true);
    });

    it('opens as PENDING — a submission cannot verify itself', async () => {
      mockPrisma.kycSubmission.create.mockResolvedValue({ id: 'kyc-1' });

      await service.createSubmission({
        userId: 'user-1',
        userRoles: ['SELLER'],
        dto: submissionDto(),
      });

      const { data } = mockPrisma.kycSubmission.create.mock.calls[0][0];
      expect(data.status).toBe(VerificationStatus.PENDING);
    });

    it('refuses a role the caller does not hold', async () => {
      await expect(
        service.createSubmission({
          userId: 'user-1',
          userRoles: ['BUYER'],
          dto: submissionDto({ role: 'FARMER' }),
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(mockPrisma.kycSubmission.create).not.toHaveBeenCalled();
    });

    it('accepts FARMER, BUYER and SELLER when the caller holds the role', async () => {
      mockPrisma.kycSubmission.create.mockResolvedValue({ id: 'kyc-1' });

      for (const role of ['FARMER', 'BUYER', 'SELLER'] as const) {
        await expect(
          service.createSubmission({
            userId: 'user-1',
            userRoles: [role],
            dto: submissionDto({ role }),
          }),
        ).resolves.toBeDefined();
      }
    });

    it('rejects a second submission while one is awaiting review', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        id: 'kyc-existing',
        status: VerificationStatus.PENDING,
      });

      await expect(
        service.createSubmission({
          userId: 'user-1',
          userRoles: ['SELLER'],
          dto: submissionDto(),
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPrisma.kycSubmission.create).not.toHaveBeenCalled();
    });

    it('rejects a resubmission over a verified record', async () => {
      mockPrisma.kycSubmission.findFirst.mockResolvedValue({
        id: 'kyc-existing',
        status: VerificationStatus.VERIFIED,
      });

      await expect(
        service.createSubmission({
          userId: 'user-1',
          userRoles: ['SELLER'],
          dto: submissionDto(),
        }),
      ).rejects.toThrow(/already KYC verified/i);
    });

    it('allows a resubmission after a rejection', async () => {
      // findFirst only matches PENDING/VERIFIED, so a REJECTED row returns null.
      mockPrisma.kycSubmission.findFirst.mockResolvedValue(null);
      mockPrisma.kycSubmission.create.mockResolvedValue({ id: 'kyc-2' });

      await expect(
        service.createSubmission({
          userId: 'user-1',
          userRoles: ['SELLER'],
          dto: submissionDto(),
        }),
      ).resolves.toEqual({ id: 'kyc-2' });

      expect(mockPrisma.kycSubmission.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            userId: 'user-1',
            status: {
              in: [VerificationStatus.PENDING, VerificationStatus.VERIFIED],
            },
          }),
        }),
      );
    });
  });

  describe('findMySubmissions', () => {
    it('scopes the query to the caller and hides the encrypted column', async () => {
      mockPrisma.kycSubmission.findMany.mockResolvedValue([]);

      await service.findMySubmissions('user-1');

      const args = mockPrisma.kycSubmission.findMany.mock.calls[0][0];
      expect(args.where).toEqual({ userId: 'user-1' });
      expect(args.orderBy).toEqual({ submittedAt: 'desc' });
      expect(args.select.accountNumberEnc).toBeUndefined();
    });
  });

  describe('listSubmissions', () => {
    it('defaults to the PENDING queue, oldest first', async () => {
      mockPrisma.kycSubmission.findMany.mockResolvedValue([]);

      await service.listSubmissions();

      expect(mockPrisma.kycSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: VerificationStatus.PENDING },
          orderBy: { submittedAt: 'asc' },
        }),
      );
    });

    it('filters by an explicit status', async () => {
      mockPrisma.kycSubmission.findMany.mockResolvedValue([]);

      await service.listSubmissions(VerificationStatus.REJECTED);

      expect(mockPrisma.kycSubmission.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { status: VerificationStatus.REJECTED } }),
      );
    });

    it('does not expose the encrypted account number to admins either', async () => {
      mockPrisma.kycSubmission.findMany.mockResolvedValue([]);

      await service.listSubmissions();

      const { select } = mockPrisma.kycSubmission.findMany.mock.calls[0][0];
      expect(select.accountNumberEnc).toBeUndefined();
    });
  });

  describe('reviewSubmission', () => {
    it('records the verdict, the reviewer and the time', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue({
        id: 'kyc-1',
        status: VerificationStatus.PENDING,
      });
      mockPrisma.kycSubmission.update.mockResolvedValue({ id: 'kyc-1' });

      await service.reviewSubmission({
        submissionId: 'kyc-1',
        status: VerificationStatus.VERIFIED,
        reviewNotes: 'Bank account confirmed',
        reviewerId: 'admin-1',
      });

      expect(mockPrisma.kycSubmission.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'kyc-1' },
          data: expect.objectContaining({
            status: VerificationStatus.VERIFIED,
            reviewNotes: 'Bank account confirmed',
            reviewedBy: 'admin-1',
            reviewedAt: expect.any(Date),
          }),
        }),
      );
    });

    it('stores null rather than undefined when no note is given', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue({
        id: 'kyc-1',
        status: VerificationStatus.PENDING,
      });
      mockPrisma.kycSubmission.update.mockResolvedValue({ id: 'kyc-1' });

      await service.reviewSubmission({
        submissionId: 'kyc-1',
        status: VerificationStatus.REJECTED,
        reviewerId: 'admin-1',
      });

      const { data } = mockPrisma.kycSubmission.update.mock.calls[0][0];
      expect(data.reviewNotes).toBeNull();
    });

    it('throws NotFound for an unknown submission and writes nothing', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue(null);

      await expect(
        service.reviewSubmission({
          submissionId: 'missing',
          status: VerificationStatus.VERIFIED,
          reviewerId: 'admin-1',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);

      expect(mockPrisma.kycSubmission.update).not.toHaveBeenCalled();
    });

    it('refuses to re-review a decided submission, preserving the audit trail', async () => {
      mockPrisma.kycSubmission.findUnique.mockResolvedValue({
        id: 'kyc-1',
        status: VerificationStatus.VERIFIED,
      });

      await expect(
        service.reviewSubmission({
          submissionId: 'kyc-1',
          status: VerificationStatus.REJECTED,
          reviewerId: 'admin-2',
        }),
      ).rejects.toBeInstanceOf(ConflictException);

      expect(mockPrisma.kycSubmission.update).not.toHaveBeenCalled();
    });
  });

  describe('requestAadhaarOtp', () => {
    it('forwards a valid number to the provider with spaces stripped', async () => {
      mockProvider.requestAadhaarOtp.mockResolvedValue({
        txnId: 'txn-1',
        expiresInSeconds: 600,
      });

      const result = await service.requestAadhaarOtp('9999 4105 7058');

      expect(mockProvider.requestAadhaarOtp).toHaveBeenCalledWith(VALID_AADHAAR);
      expect(result).toEqual({ txnId: 'txn-1', expiresInSeconds: 600 });
    });

    it('rejects a number that fails the Verhoeff checksum', async () => {
      await expect(service.requestAadhaarOtp('999941057059')).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(mockProvider.requestAadhaarOtp).not.toHaveBeenCalled();
    });

    it.each(['9999410570580', '99994105705', '', '99994105705X'])(
      'rejects malformed input %p without calling the verifier',
      async (value) => {
        await expect(service.requestAadhaarOtp(value)).rejects.toBeInstanceOf(
          BadRequestException,
        );
        expect(mockProvider.requestAadhaarOtp).not.toHaveBeenCalled();
      },
    );

    it('never puts the full number in the rejection message', async () => {
      await expect(service.requestAadhaarOtp('999941057059')).rejects.toThrow(
        expect.objectContaining({
          message: expect.not.stringContaining('999941057059'),
        }),
      );
    });
  });

  describe('verifyAadhaarOtp', () => {
    it('returns the reference and last four digits from the provider', async () => {
      mockProvider.verifyAadhaarOtp.mockResolvedValue({
        referenceId: 'txn-1',
        aadhaarLast4: '7058',
        method: KycIdentityMethod.AADHAAR_OTP,
      });

      await expect(service.verifyAadhaarOtp('txn-1', '123456')).resolves.toEqual({
        referenceId: 'txn-1',
        aadhaarLast4: '7058',
        method: KycIdentityMethod.AADHAAR_OTP,
      });
    });

    it('translates a rejected OTP into 401, not 500', async () => {
      mockProvider.verifyAadhaarOtp.mockRejectedValue(new OtpRejectedError());

      await expect(service.verifyAadhaarOtp('txn-1', '000000')).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });

    it('lets a provider outage propagate untouched', async () => {
      const outage = new Error('KUA gateway timeout');
      mockProvider.verifyAadhaarOtp.mockRejectedValue(outage);

      await expect(service.verifyAadhaarOtp('txn-1', '123456')).rejects.toBe(outage);
    });
  });
});
