import { Type } from 'class-transformer';
import {
  IsIn,
  IsNotEmpty,
  IsObject,
  IsString,
  Matches,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';
import { KycIdentityMethod } from '@prisma/client';

/**
 * The KycSubmission payload the web KYC panel posts
 * (frontend-stubs/web-overhaul/src/components/auth/KYCPanel.tsx). Field names
 * and nesting match that interface exactly, so the panel's `onComplete` can
 * send its submission object unchanged.
 */

/** Roles that go through this KYC flow — KycRole in the panel. */
export const KYC_ROLES = ['FARMER', 'BUYER', 'SELLER'] as const;
export type KycRole = (typeof KYC_ROLES)[number];

export class KycIdentityDto {
  @ApiProperty({ enum: KycIdentityMethod, example: KycIdentityMethod.AADHAAR_OTP })
  @IsIn(Object.values(KycIdentityMethod), {
    message: `method must be one of: ${Object.values(KycIdentityMethod).join(', ')}`,
  })
  method!: KycIdentityMethod;

  /**
   * The verifier's reference, stored in place of the Aadhaar number. There is
   * deliberately no `aadhaarNumber` field on this DTO: a full number must never
   * be accepted by the submission endpoint, so it cannot be stored by accident.
   */
  @ApiProperty({ example: 'sandbox-otp-7f3a91c0de' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  referenceId!: string;

  @ApiProperty({ example: '9012', description: 'Last four digits only.' })
  @Matches(/^[0-9]{4}$/, { message: 'aadhaarLast4 must be exactly 4 digits' })
  aadhaarLast4!: string;

  @ApiProperty({ example: 'ABCPK1234L' })
  @Matches(/^[A-Z]{3}[PCHFATBLJG][A-Z][0-9]{4}[A-Z]$/, {
    message:
      'pan must be 10 characters in the form AAAPA1234A, ' +
      'with a valid holder-type letter in position 4',
  })
  pan!: string;
}

export class KycBankDto {
  @ApiProperty({ example: 'JAKA0SRINAG' })
  @Matches(/^[A-Z]{4}0[A-Z0-9]{6}$/, {
    message: 'ifsc must be 11 characters in the form AAAA0XXXXXX',
  })
  ifsc!: string;

  @ApiProperty({ example: 'Jammu & Kashmir Bank' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  bankName!: string;

  @ApiProperty({ example: 'Srinagar Main' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  branch!: string;

  /** Encrypted before it is stored; never returned by any read endpoint. */
  @ApiProperty({ example: '001234567890' })
  @Matches(/^[0-9]{9,18}$/, {
    message: 'accountNumber must be 9 to 18 digits',
  })
  accountNumber!: string;
}

export class CreateKycSubmissionDto {
  @ApiProperty({ enum: KYC_ROLES, example: 'SELLER' })
  @IsIn(KYC_ROLES, { message: `role must be one of: ${KYC_ROLES.join(', ')}` })
  role!: KycRole;

  @ApiProperty({ type: KycIdentityDto })
  @IsObject()
  @ValidateNested()
  @Type(() => KycIdentityDto)
  identity!: KycIdentityDto;

  @ApiProperty({ type: KycBankDto })
  @IsObject()
  @ValidateNested()
  @Type(() => KycBankDto)
  bank!: KycBankDto;
}
