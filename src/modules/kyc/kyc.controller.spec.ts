import { Test, TestingModule } from '@nestjs/testing';
import { ArgumentMetadata, BadRequestException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { KycIdentityMethod, VerificationStatus } from '@prisma/client';

import { KycController } from './kyc.controller';
import { KycAdminController } from './kyc-admin.controller';
import { KycService } from './kyc.service';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';
import { CreateKycSubmissionDto } from './dto/create-kyc-submission.dto';
import { createIdentityVerificationProvider } from './kyc.module';
import { SandboxIdentityVerificationProvider } from './providers/sandbox-identity-verification.provider';
import { UnconfiguredIdentityVerificationProvider } from './providers/unconfigured-identity-verification.provider';

const kycService = {
  createSubmission: jest.fn(),
  findMySubmissions: jest.fn(),
  listSubmissions: jest.fn(),
  reviewSubmission: jest.fn(),
  requestAadhaarOtp: jest.fn(),
  verifyAadhaarOtp: jest.fn(),
};

function user(overrides: Partial<AuthenticatedUser> = {}): AuthenticatedUser {
  return {
    sub: 'user-1',
    roles: ['SELLER'],
    regionIds: [],
    permissions: [],
    mfaVerified: true,
    ...overrides,
  } as AuthenticatedUser;
}

function validPayload(): Record<string, unknown> {
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
  };
}

describe('KycController', () => {
  let controller: KycController;
  let adminController: KycAdminController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [KycController, KycAdminController],
      providers: [{ provide: KycService, useValue: kycService }],
    }).compile();

    controller = module.get(KycController);
    adminController = module.get(KycAdminController);
  });

  afterEach(() => jest.clearAllMocks());

  describe('POST /kyc/submissions', () => {
    it('passes the identity from the token, not the body', async () => {
      kycService.createSubmission.mockResolvedValue({ id: 'kyc-1' });

      await controller.createSubmission(
        validPayload() as unknown as CreateKycSubmissionDto,
        user({ sub: 'user-from-token', roles: ['SELLER'] }),
      );

      expect(kycService.createSubmission).toHaveBeenCalledWith(
        expect.objectContaining({ userId: 'user-from-token', userRoles: ['SELLER'] }),
      );
    });
  });

  describe('GET /kyc/submissions/me', () => {
    it('reads only the caller’s own submissions', async () => {
      kycService.findMySubmissions.mockResolvedValue([]);

      await controller.findMine(user({ sub: 'user-9' }));

      expect(kycService.findMySubmissions).toHaveBeenCalledWith('user-9');
    });
  });

  describe('POST /kyc/aadhaar/otp and /verify', () => {
    it('forwards the number to the service, which validates it', async () => {
      kycService.requestAadhaarOtp.mockResolvedValue({ txnId: 't', expiresInSeconds: 600 });

      await controller.requestAadhaarOtp({ aadhaarNumber: '999941057058' });

      expect(kycService.requestAadhaarOtp).toHaveBeenCalledWith('999941057058');
    });

    it('forwards txnId and otp to the service', async () => {
      kycService.verifyAadhaarOtp.mockResolvedValue({});

      await controller.verifyAadhaarOtp({ txnId: 'txn-1', otp: '123456' });

      expect(kycService.verifyAadhaarOtp).toHaveBeenCalledWith('txn-1', '123456');
    });
  });

  describe('admin routes', () => {
    it('defaults the list to the pending queue', async () => {
      kycService.listSubmissions.mockResolvedValue([]);

      await adminController.list(undefined);

      expect(kycService.listSubmissions).toHaveBeenCalledWith(VerificationStatus.PENDING);
    });

    it('passes an explicit status through', async () => {
      kycService.listSubmissions.mockResolvedValue([]);

      await adminController.list(VerificationStatus.VERIFIED);

      expect(kycService.listSubmissions).toHaveBeenCalledWith(VerificationStatus.VERIFIED);
    });

    it('attributes the review to the admin in the token', async () => {
      kycService.reviewSubmission.mockResolvedValue({ id: 'kyc-1' });

      await adminController.review(
        'kyc-1',
        { status: VerificationStatus.VERIFIED, reviewNotes: 'ok' },
        user({ sub: 'admin-7', roles: ['SUPER_ADMIN'] }),
      );

      expect(kycService.reviewSubmission).toHaveBeenCalledWith({
        submissionId: 'kyc-1',
        status: VerificationStatus.VERIFIED,
        reviewNotes: 'ok',
        reviewerId: 'admin-7',
      });
    });
  });
});

/**
 * The submission payload is only as safe as its validation, so the rules are
 * exercised through a ValidationPipe configured exactly as main.ts configures
 * the global one — including forbidNonWhitelisted, which is what stops an
 * `aadhaarNumber` field being smuggled into a submission.
 */
describe('CreateKycSubmissionDto validation', () => {
  const pipe = new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
    transformOptions: { enableImplicitConversion: true },
  });

  const meta: ArgumentMetadata = {
    type: 'body',
    metatype: CreateKycSubmissionDto,
    data: '',
  };

  /** Returns the validation message, or null when the payload is accepted. */
  async function reject(payload: unknown): Promise<string | null> {
    try {
      await pipe.transform(payload, meta);
      return null;
    } catch (err) {
      expect(err).toBeInstanceOf(BadRequestException);
      return JSON.stringify((err as BadRequestException).getResponse());
    }
  }

  it('accepts a well-formed submission', async () => {
    await expect(pipe.transform(validPayload(), meta)).resolves.toBeInstanceOf(
      CreateKycSubmissionDto,
    );
  });

  it.each(['FARMER', 'BUYER', 'SELLER'])('accepts role %s', async (role) => {
    await expect(
      pipe.transform({ ...validPayload(), role }, meta),
    ).resolves.toBeDefined();
  });

  it.each(['SUPER_ADMIN', 'EXPERT', 'farmer', ''])(
    'rejects role %p',
    async (role) => {
      expect(await reject({ ...validPayload(), role })).toContain('role must be one of');
    },
  );

  it('rejects an unknown top-level field', async () => {
    const payload = { ...validPayload(), isVerified: true };
    expect(await reject(payload)).toContain('isVerified');
  });

  it('rejects a full Aadhaar number smuggled into the identity object', async () => {
    const payload = validPayload();
    (payload.identity as Record<string, unknown>).aadhaarNumber = '999941057058';
    expect(await reject(payload)).toContain('aadhaarNumber');
  });

  describe('ifsc', () => {
    it.each(['JAKA0SRINAG', 'SBIN0000456', 'HDFC0CAGSBK'])('accepts %s', async (ifsc) => {
      const payload = validPayload();
      (payload.bank as Record<string, unknown>).ifsc = ifsc;
      expect(await reject(payload)).toBeNull();
    });

    it.each([
      'JAKA1SRINAG', // fifth character must be 0
      'JAK0SRINAGX', // only four letters for the bank code
      'JAKA0SRINA', // ten characters
      'JAKA0SRINAGG', // twelve characters
      'jaka0srinag', // lower case
      '',
    ])('rejects %p', async (ifsc) => {
      const payload = validPayload();
      (payload.bank as Record<string, unknown>).ifsc = ifsc;
      expect(await reject(payload)).toContain('ifsc must be 11 characters');
    });
  });

  describe('pan', () => {
    it.each(['ABCPK1234L', 'AAACH1234Q', 'ZZZF A1234B'.replace(' ', '')])(
      'accepts %s',
      async (pan) => {
        const payload = validPayload();
        (payload.identity as Record<string, unknown>).pan = pan;
        expect(await reject(payload)).toBeNull();
      },
    );

    it.each([
      'ABCZK1234L', // Z is not a holder type
      'ABCP11234L', // position 5 must be a letter
      'ABCPK123L4', // digits must occupy positions 6-9
      'ABCPK1234', // nine characters
      'abcpk1234l', // lower case
      '',
    ])('rejects %p', async (pan) => {
      const payload = validPayload();
      (payload.identity as Record<string, unknown>).pan = pan;
      expect(await reject(payload)).toContain('pan must be 10 characters');
    });

    it.each(['P', 'C', 'H', 'F', 'A', 'T', 'B', 'L', 'J', 'G'])(
      'accepts holder type %s in position 4',
      async (holder) => {
        const payload = validPayload();
        (payload.identity as Record<string, unknown>).pan = `ABC${holder}K1234L`;
        expect(await reject(payload)).toBeNull();
      },
    );
  });

  describe('accountNumber', () => {
    it.each(['123456789', '0'.repeat(18), '001234567890'])(
      'accepts %s digits',
      async (accountNumber) => {
        const payload = validPayload();
        (payload.bank as Record<string, unknown>).accountNumber = accountNumber;
        expect(await reject(payload)).toBeNull();
      },
    );

    it.each([
      '12345678', // eight digits
      '1'.repeat(19), // nineteen digits
      '12345678A',
      '1234 56789',
      '',
    ])('rejects %p', async (accountNumber) => {
      const payload = validPayload();
      (payload.bank as Record<string, unknown>).accountNumber = accountNumber;
      expect(await reject(payload)).toContain('accountNumber must be 9 to 18 digits');
    });
  });

  describe('aadhaarLast4', () => {
    it.each(['0000', '7058'])('accepts %s', async (value) => {
      const payload = validPayload();
      (payload.identity as Record<string, unknown>).aadhaarLast4 = value;
      expect(await reject(payload)).toBeNull();
    });

    it.each(['705', '70588', '70X8', '', '999941057058'])(
      'rejects %p',
      async (value) => {
        const payload = validPayload();
        (payload.identity as Record<string, unknown>).aadhaarLast4 = value;
        expect(await reject(payload)).toContain('aadhaarLast4 must be exactly 4 digits');
      },
    );
  });

  describe('identity.method', () => {
    it.each([KycIdentityMethod.AADHAAR_OTP, KycIdentityMethod.DIGILOCKER])(
      'accepts %s',
      async (method) => {
        const payload = validPayload();
        (payload.identity as Record<string, unknown>).method = method;
        expect(await reject(payload)).toBeNull();
      },
    );

    it('rejects an unknown method', async () => {
      const payload = validPayload();
      (payload.identity as Record<string, unknown>).method = 'TRUST_ME';
      expect(await reject(payload)).toContain('method must be one of');
    });
  });
});

/**
 * The sandbox verifier must be impossible to reach by accident: that is the
 * difference between a simulated identity and an unverified one being recorded
 * as verified.
 */
describe('createIdentityVerificationProvider', () => {
  function config(values: Record<string, string | undefined>): ConfigService {
    return { get: (key: string) => values[key] } as unknown as ConfigService;
  }

  it('returns the sandbox when KYC_PROVIDER=sandbox outside production', () => {
    const provider = createIdentityVerificationProvider(
      config({ KYC_PROVIDER: 'sandbox', NODE_ENV: 'development' }),
    );
    expect(provider).toBeInstanceOf(SandboxIdentityVerificationProvider);
  });

  it('accepts the value case-insensitively and with stray whitespace', () => {
    const provider = createIdentityVerificationProvider(
      config({ KYC_PROVIDER: ' Sandbox ', NODE_ENV: 'test' }),
    );
    expect(provider).toBeInstanceOf(SandboxIdentityVerificationProvider);
  });

  it('refuses to start at all with the sandbox selected in production', () => {
    expect(() =>
      createIdentityVerificationProvider(
        config({ KYC_PROVIDER: 'sandbox', NODE_ENV: 'production' }),
      ),
    ).toThrow(/refused when NODE_ENV=production/);
  });

  it.each([undefined, '', 'uidai', 'digilocker'])(
    'falls back to the unconfigured provider for KYC_PROVIDER=%p',
    (value) => {
      const provider = createIdentityVerificationProvider(
        config({ KYC_PROVIDER: value, NODE_ENV: 'development' }),
      );
      expect(provider).toBeInstanceOf(UnconfiguredIdentityVerificationProvider);
    },
  );

  it('answers 503 rather than verifying when unconfigured', async () => {
    const provider = createIdentityVerificationProvider(
      config({ NODE_ENV: 'development' }),
    );
    await expect(provider.verifyAadhaarOtp('txn', '123456')).rejects.toThrow(
      /not configured/i,
    );
  });
});

describe('SandboxIdentityVerificationProvider', () => {
  let provider: SandboxIdentityVerificationProvider;

  beforeEach(() => {
    provider = new SandboxIdentityVerificationProvider();
  });

  it('verifies any six-digit OTP and returns the last four digits', async () => {
    const { txnId } = await provider.requestAadhaarOtp('999941057058');

    const result = await provider.verifyAadhaarOtp(txnId, '123456');

    expect(result).toEqual({
      referenceId: txnId,
      aadhaarLast4: '7058',
      method: KycIdentityMethod.AADHAAR_OTP,
    });
  });

  it('always rejects 000000, so the failure path can be exercised', async () => {
    const { txnId } = await provider.requestAadhaarOtp('999941057058');

    await expect(provider.verifyAadhaarOtp(txnId, '000000')).rejects.toThrow(
      /incorrect or has expired/,
    );
  });

  it('rejects an unknown transaction', async () => {
    await expect(provider.verifyAadhaarOtp('never-issued', '123456')).rejects.toThrow(
      /incorrect or has expired/,
    );
  });

  it('spends a challenge once, so a verification cannot be replayed', async () => {
    const { txnId } = await provider.requestAadhaarOtp('999941057058');

    await expect(provider.verifyAadhaarOtp(txnId, '123456')).resolves.toBeDefined();
    await expect(provider.verifyAadhaarOtp(txnId, '123456')).rejects.toThrow(
      /incorrect or has expired/,
    );
  });

  it('never returns the full Aadhaar number', async () => {
    const { txnId } = await provider.requestAadhaarOtp('999941057058');
    const result = await provider.verifyAadhaarOtp(txnId, '123456');

    expect(JSON.stringify(result)).not.toContain('999941057058');
  });
});
