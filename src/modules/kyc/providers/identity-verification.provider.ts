import { KycIdentityMethod } from '@prisma/client';

/**
 * The seam between KashRoot and whoever actually verifies an identity.
 *
 * Real Aadhaar e-KYC is only legal through a UIDAI-licensed KUA or a DigiLocker
 * partner (API Setu), under credentials that must never reach a browser. This
 * interface is what the KYC service talks to, so a licensed provider can be
 * dropped in behind it without touching controllers, DTOs or storage.
 *
 * Implementations must never log, persist or return a full Aadhaar number. The
 * result carries the verifier's reference plus the last four digits, which is
 * the most we are permitted to keep.
 */
export const IDENTITY_VERIFICATION_PROVIDER = Symbol('IDENTITY_VERIFICATION_PROVIDER');

/** Handle for an OTP in flight. Opaque to the client beyond round-tripping it. */
export interface AadhaarOtpChallenge {
  txnId: string;
  /** How long the client may wait before the code is rejected. */
  expiresInSeconds: number;
}

export interface IdentityVerificationResult {
  /** The verifier's reference, stored in place of the Aadhaar number. */
  referenceId: string;
  aadhaarLast4: string;
  method: KycIdentityMethod;
}

/** Where to send the user for DigiLocker consent, and the state to expect back. */
export interface DigiLockerAuthorization {
  authorizationUrl: string;
  state: string;
}

export interface IdentityVerificationProvider {
  /** Name reported in diagnostics; never a credential. */
  readonly name: string;

  /**
   * Ask the verifier to send an OTP to the Aadhaar-linked mobile.
   * @param aadhaarNumber Full number — used for this call only, never stored.
   */
  requestAadhaarOtp(aadhaarNumber: string): Promise<AadhaarOtpChallenge>;

  /** Exchange a txnId plus the code the user received for a verified identity. */
  verifyAadhaarOtp(txnId: string, otp: string): Promise<IdentityVerificationResult>;

  /** Begin a DigiLocker consent redirect. */
  startDigiLocker(redirectUri: string): Promise<DigiLockerAuthorization>;

  /** Complete the consent flow from the callback's state and code. */
  completeDigiLocker(state: string, code: string): Promise<IdentityVerificationResult>;
}

/** Thrown when the user's code is wrong, expired or already spent. */
export class OtpRejectedError extends Error {
  constructor(message = 'That OTP is incorrect or has expired.') {
    super(message);
    this.name = 'OtpRejectedError';
  }
}
