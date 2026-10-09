import { Logger, Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { FieldEncryptionService } from '../../common/utils/field-encryption.service';
import { KycController } from './kyc.controller';
import { KycAdminController } from './kyc-admin.controller';
import { KycService } from './kyc.service';
import {
  IDENTITY_VERIFICATION_PROVIDER,
  IdentityVerificationProvider,
} from './providers/identity-verification.provider';
import { SandboxIdentityVerificationProvider } from './providers/sandbox-identity-verification.provider';
import { UnconfiguredIdentityVerificationProvider } from './providers/unconfigured-identity-verification.provider';

/**
 * Chooses the identity verifier from KYC_PROVIDER.
 *
 * Exported so the selection rule can be tested without standing up the module.
 */
export function createIdentityVerificationProvider(
  config: ConfigService,
): IdentityVerificationProvider {
  const configured = (config.get<string>('KYC_PROVIDER') ?? '').trim().toLowerCase();
  const isProduction = config.get<string>('NODE_ENV') === 'production';

  if (configured === 'sandbox') {
    /*
     * The sandbox approves any six-digit code. Reaching production with it
     * selected would mean every identity on the platform is unverified while
     * appearing verified, so this is a startup failure rather than a warning
     * somebody scrolls past.
     */
    if (isProduction) {
      throw new Error(
        'KYC_PROVIDER=sandbox is refused when NODE_ENV=production: the sandbox ' +
          'accepts any OTP and verifies nobody. Configure a licensed KUA or ' +
          'DigiLocker partner.',
      );
    }
    new Logger('KycModule').warn(
      'KYC_PROVIDER=sandbox — Aadhaar identities are SIMULATED, not verified.',
    );
    return new SandboxIdentityVerificationProvider();
  }

  // Anything else, including unset: identity endpoints answer 503 and nothing
  // is ever recorded as verified by accident.
  return new UnconfiguredIdentityVerificationProvider(configured);
}

@Module({
  imports: [ConfigModule, PrismaModule],
  controllers: [KycController, KycAdminController],
  providers: [
    KycService,
    FieldEncryptionService,
    {
      provide: IDENTITY_VERIFICATION_PROVIDER,
      inject: [ConfigService],
      useFactory: createIdentityVerificationProvider,
    },
  ],
  exports: [KycService],
})
export class KycModule {}
