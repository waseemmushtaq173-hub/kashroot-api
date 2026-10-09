import { ServiceUnavailableException } from '@nestjs/common';

import {
  AadhaarOtpChallenge,
  DigiLockerAuthorization,
  IdentityVerificationProvider,
  IdentityVerificationResult,
} from './identity-verification.provider';

/**
 * What the application runs with until a licensed verifier is wired up: every
 * identity call fails with 503.
 *
 * The alternative — falling back to the sandbox whenever KYC_PROVIDER is unset
 * — is how a deployment ends up approving identities nobody verified. Failing
 * loudly keeps that impossible, and leaves the rest of the KYC surface
 * (submissions, admin review) working.
 */
export class UnconfiguredIdentityVerificationProvider implements IdentityVerificationProvider {
  readonly name: string;

  constructor(configuredValue: string) {
    this.name = configuredValue ? `unsupported:${configuredValue}` : 'unconfigured';
  }

  requestAadhaarOtp(): Promise<AadhaarOtpChallenge> {
    return Promise.reject(this.unavailable());
  }

  verifyAadhaarOtp(): Promise<IdentityVerificationResult> {
    return Promise.reject(this.unavailable());
  }

  startDigiLocker(): Promise<DigiLockerAuthorization> {
    return Promise.reject(this.unavailable());
  }

  completeDigiLocker(): Promise<IdentityVerificationResult> {
    return Promise.reject(this.unavailable());
  }

  private unavailable(): ServiceUnavailableException {
    return new ServiceUnavailableException(
      'Identity verification is not configured on this deployment.',
    );
  }
}
