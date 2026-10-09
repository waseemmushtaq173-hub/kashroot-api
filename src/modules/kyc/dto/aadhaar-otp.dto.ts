import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Aadhaar OTP request. This is the one place a full Aadhaar number is accepted;
 * it is passed to the verifier and discarded. It is never written to the
 * database and never logged — KycService masks it before any log line.
 */
export class RequestAadhaarOtpDto {
  @ApiProperty({
    example: '234567890123',
    description: 'Twelve digits. Spaces are accepted and stripped.',
  })
  @IsString()
  @MaxLength(20)
  // Shape only; KycService strips the spaces and applies the UIDAI rules
  // (first digit 2-9, Verhoeff check digit) before the number leaves the
  // process. Keeping those in one place avoids two half-checks disagreeing.
  @Matches(/^[0-9][0-9\s]*[0-9]$/, {
    message: 'aadhaarNumber must be 12 digits',
  })
  aadhaarNumber!: string;
}

export class VerifyAadhaarOtpDto {
  @ApiProperty({ example: 'sandbox-otp-7f3a91c0de' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  txnId!: string;

  @ApiProperty({ example: '123456' })
  @Matches(/^[0-9]{6}$/, { message: 'otp must be exactly 6 digits' })
  otp!: string;
}
