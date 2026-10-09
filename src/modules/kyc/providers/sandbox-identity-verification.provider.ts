import { Logger } from '@nestjs/common';
import { KycIdentityMethod } from '@prisma/client';
import { randomBytes } from 'crypto';

import { aadhaarLast4, maskAadhaar } from '../aadhaar.util';
import {
  AadhaarOtpChallenge,
  DigiLockerAuthorization,
  IdentityVerificationProvider,
  IdentityVerificationResult,
  OtpRejectedError,
} from './identity-verification.provider';

/** How long a sandbox challenge stays redeemable. Mirrors UIDAI's 10 minutes. */
const CHALLENGE_TTL_MS = 10 * 60_000;

/**
 * Development and test stand-in for a licensed verifier. Selected only when
 * KYC_PROVIDER=sandbox, and refused outright in production — see the factory in
 * kyc.module.ts.
 *
 * Rules, matching the web panel's simulation so the two agree end to end:
 *   - any Aadhaar the service accepted as structurally valid receives an OTP;
 *   - any six-digit OTP verifies, except 000000, which is always rejected so
 *     the failure path can be exercised;
 *   - DigiLocker consent is granted instantly.
 *
 * Challenges live in memory, so they do not survive a restart and are not
 * shared between instances. That is adequate for a single dev process and
 * another reason this must never run in production.
 */
export class SandboxIdentityVerificationProvider implements IdentityVerificationProvider {
  readonly name = 'sandbox';

  private readonly logger = new Logger(SandboxIdentityVerificationProvider.name);

  /** txnId -> the last four digits plus when the challenge lapses. */
  private readonly challenges = new Map<string, { last4: string; expiresAt: number }>();

  async requestAadhaarOtp(aadhaarNumber: string): Promise<AadhaarOtpChallenge> {
    this.sweepExpired();

    const txnId = `sandbox-otp-${randomBytes(9).toString('hex')}`;
    this.challenges.set(txnId, {
      last4: aadhaarLast4(aadhaarNumber),
      expiresAt: Date.now() + CHALLENGE_TTL_MS,
    });

    // Masked: a full Aadhaar number in a log file is the exact disclosure the
    // storage rules exist to prevent, and dev logs get pasted into issues.
    this.logger.log(
      `Sandbox OTP issued for ${maskAadhaar(aadhaarNumber)} (txn ${txnId}). ` +
        'Any 6-digit code except 000000 will verify.',
    );

    return { txnId, expiresInSeconds: CHALLENGE_TTL_MS / 1000 };
  }

  async verifyAadhaarOtp(txnId: string, otp: string): Promise<IdentityVerificationResult> {
    this.sweepExpired();

    const challenge = this.challenges.get(txnId);
    if (!challenge || !/^[0-9]{6}$/.test(otp) || otp === '000000') {
      throw new OtpRejectedError();
    }

    // Single use: a verified challenge cannot be replayed into a second
    // submission.
    this.challenges.delete(txnId);

    return {
      referenceId: txnId,
      aadhaarLast4: challenge.last4,
      method: KycIdentityMethod.AADHAAR_OTP,
    };
  }

  async startDigiLocker(redirectUri: string): Promise<DigiLockerAuthorization> {
    const state = `sandbox-dl-${randomBytes(9).toString('hex')}`;
    const url = new URL('https://sandbox.digilocker.invalid/consent');
    url.searchParams.set('state', state);
    url.searchParams.set('redirect_uri', redirectUri);
    return { authorizationUrl: url.toString(), state };
  }

  async completeDigiLocker(state: string, _code: string): Promise<IdentityVerificationResult> {
    return {
      referenceId: state,
      // The real flow reads these from the signed Aadhaar XML; the sandbox has
      // no document to read, so it reports zeroes rather than inventing digits
      // that look like someone's identity.
      aadhaarLast4: '0000',
      method: KycIdentityMethod.DIGILOCKER,
    };
  }

  private sweepExpired(): void {
    const now = Date.now();
    for (const [txnId, challenge] of this.challenges) {
      if (challenge.expiresAt <= now) this.challenges.delete(txnId);
    }
  }
}
