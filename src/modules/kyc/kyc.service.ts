import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, RoleName, VerificationStatus } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { FieldEncryptionService } from '../../common/utils/field-encryption.service';
import { isValidAadhaar, maskAadhaar, normaliseAadhaar } from './aadhaar.util';
import { CreateKycSubmissionDto, KycRole } from './dto/create-kyc-submission.dto';
import {
  AadhaarOtpChallenge,
  IDENTITY_VERIFICATION_PROVIDER,
  IdentityVerificationProvider,
  IdentityVerificationResult,
  OtpRejectedError,
} from './providers/identity-verification.provider';

/**
 * Columns safe to return over HTTP.
 *
 * accountNumberEnc is excluded by construction rather than deleted afterwards:
 * an explicit `select` means a future column is invisible until someone adds it
 * here, which is the right default for a table holding bank details. The
 * account number is write-only — nothing reads it back out, and
 * accountNumberLast4 covers display.
 */
const SUBMISSION_SELECT = {
  id: true,
  userId: true,
  role: true,
  identityMethod: true,
  referenceId: true,
  aadhaarLast4: true,
  pan: true,
  ifsc: true,
  bankName: true,
  branch: true,
  accountNumberLast4: true,
  status: true,
  reviewNotes: true,
  reviewedBy: true,
  reviewedAt: true,
  submittedAt: true,
  updatedAt: true,
} satisfies Prisma.KycSubmissionSelect;

@Injectable()
export class KycService {
  private readonly logger = new Logger(KycService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly encryption: FieldEncryptionService,
    @Inject(IDENTITY_VERIFICATION_PROVIDER)
    private readonly identity: IdentityVerificationProvider,
  ) {}

  // ─── Submissions ────────────────────────────────────────────────────

  /**
   * Record a verified identity and bank account for the authenticated user.
   *
   * The account number is encrypted here, on the way in, so the plaintext
   * exists only for the life of this call.
   */
  async createSubmission(input: {
    userId: string;
    userRoles: RoleName[];
    dto: CreateKycSubmissionDto;
  }) {
    const { userId, userRoles, dto } = input;

    /*
     * The submitted role must be one the caller actually holds. RolesGuard only
     * establishes that they hold *some* role in the KYC set, so without this a
     * buyer could file a submission as a FARMER and have an admin approve it as
     * farmer verification.
     */
    if (!userRoles.includes(dto.role as RoleName)) {
      throw new ForbiddenException(
        `You do not hold the ${dto.role} role, so you cannot submit KYC as one.`,
      );
    }

    /*
     * One live submission at a time. A second PENDING row would put the same
     * person in the review queue twice, and re-submitting over a VERIFIED
     * record would silently drop someone back to unverified. A REJECTED record
     * is not a blocker: fixing the details and trying again is the point.
     */
    const existing = await this.prisma.kycSubmission.findFirst({
      where: {
        userId,
        status: { in: [VerificationStatus.PENDING, VerificationStatus.VERIFIED] },
      },
      select: { id: true, status: true },
    });
    if (existing) {
      throw new ConflictException(
        existing.status === VerificationStatus.VERIFIED
          ? 'This account is already KYC verified.'
          : 'A KYC submission is already awaiting review.',
      );
    }

    const accountNumber = dto.bank.accountNumber;

    return this.prisma.kycSubmission.create({
      data: {
        user: { connect: { id: userId } },
        role: dto.role as RoleName,
        identityMethod: dto.identity.method,
        referenceId: dto.identity.referenceId,
        aadhaarLast4: dto.identity.aadhaarLast4,
        pan: dto.identity.pan.toUpperCase(),
        ifsc: dto.bank.ifsc.toUpperCase(),
        bankName: dto.bank.bankName,
        branch: dto.bank.branch,
        accountNumberEnc: this.encryption.encrypt(accountNumber),
        accountNumberLast4: accountNumber.slice(-4),
        status: VerificationStatus.PENDING,
      },
      select: SUBMISSION_SELECT,
    });
  }

  /** The authenticated user's own submissions, newest first. */
  async findMySubmissions(userId: string) {
    return this.prisma.kycSubmission.findMany({
      where: { userId },
      orderBy: { submittedAt: 'desc' },
      select: SUBMISSION_SELECT,
    });
  }

  // ─── Admin moderation ───────────────────────────────────────────────

  /**
   * Submissions for the admin queue, oldest first so the longest wait is
   * reviewed next. Defaults to PENDING — the queue, not the archive.
   */
  async listSubmissions(status: VerificationStatus = VerificationStatus.PENDING) {
    return this.prisma.kycSubmission.findMany({
      where: { status },
      orderBy: { submittedAt: 'asc' },
      select: {
        ...SUBMISSION_SELECT,
        user: { select: { id: true, email: true, phone: true, status: true } },
      },
    });
  }

  /**
   * Admin verdict on one submission.
   *
   * Only a PENDING row may be decided: re-reviewing a closed submission would
   * overwrite the original reviewer and timestamp, losing the audit trail of
   * who approved what.
   */
  async reviewSubmission(input: {
    submissionId: string;
    status: typeof VerificationStatus.VERIFIED | typeof VerificationStatus.REJECTED;
    reviewNotes?: string;
    reviewerId: string;
  }) {
    const submission = await this.prisma.kycSubmission.findUnique({
      where: { id: input.submissionId },
      select: { id: true, status: true },
    });
    if (!submission) {
      throw new NotFoundException(`KYC submission ${input.submissionId} not found.`);
    }
    if (submission.status !== VerificationStatus.PENDING) {
      throw new ConflictException(
        `Submission ${submission.id} was already reviewed (${submission.status}).`,
      );
    }

    return this.prisma.kycSubmission.update({
      where: { id: submission.id },
      data: {
        status: input.status,
        reviewNotes: input.reviewNotes ?? null,
        reviewedBy: input.reviewerId,
        reviewedAt: new Date(),
      },
      select: SUBMISSION_SELECT,
    });
  }

  // ─── Identity verification ──────────────────────────────────────────

  /**
   * Ask the configured verifier to send an OTP to the Aadhaar-linked mobile.
   *
   * The number is validated, used for the call and dropped. Nothing returned
   * from here carries it, and the only log line about it is masked.
   */
  async requestAadhaarOtp(aadhaarNumber: string): Promise<AadhaarOtpChallenge> {
    const digits = normaliseAadhaar(aadhaarNumber);

    if (!isValidAadhaar(digits)) {
      // The message says what is wrong without echoing the input: validation
      // errors are logged and returned, and a rejected number is still somebody's
      // Aadhaar number.
      throw new BadRequestException(
        'aadhaarNumber is not a valid Aadhaar number (12 digits, first digit 2-9, checksum must match).',
      );
    }

    const challenge = await this.identity.requestAadhaarOtp(digits);
    this.logger.log(
      `Aadhaar OTP requested via ${this.identity.name} for ${maskAadhaar(digits)}.`,
    );
    return challenge;
  }

  /** Exchange a challenge and the user's code for a verified identity. */
  async verifyAadhaarOtp(txnId: string, otp: string): Promise<IdentityVerificationResult> {
    try {
      return await this.identity.verifyAadhaarOtp(txnId, otp);
    } catch (err) {
      /*
       * A wrong code is a 401, not a 500. The provider's own error type is
       * translated here so providers stay free of HTTP concerns; anything else
       * (a verifier outage, a bad credential) propagates untouched and is
       * handled by GlobalExceptionFilter.
       */
      if (err instanceof OtpRejectedError) {
        throw new UnauthorizedException(err.message);
      }
      throw err;
    }
  }
}
