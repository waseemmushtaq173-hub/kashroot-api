import { Body, Controller, Get, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { KycService } from './kyc.service';
import { CreateKycSubmissionDto } from './dto/create-kyc-submission.dto';
import { RequestAadhaarOtpDto, VerifyAadhaarOtpDto } from './dto/aadhaar-otp.dto';

/**
 * Self-service KYC for the three roles that trade on the platform. Admin
 * moderation lives in KycAdminController.
 *
 * Identity routes are throttled well below the global limit: each one is a
 * billed call to a licensed verifier and an SMS to a real phone, so the
 * ceiling that matters is the one that stops a loop from running up a bill or
 * spamming someone's handset — not the 100/min that protects the API.
 */
const OTP_REQUEST_LIMIT = { default: { limit: 5, ttl: 60_000 } };
const OTP_VERIFY_LIMIT = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('KYC')
@ApiBearerAuth()
@Controller('kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.FARMER, UserRole.BUYER, UserRole.SELLER)
export class KycController {
  constructor(private readonly kyc: KycService) {}

  /** POST /api/v1/kyc/submissions — file verified identity and bank details. */
  @Post('submissions')
  @ApiOperation({ summary: 'Submit KYC identity and bank details' })
  createSubmission(
    @Body() dto: CreateKycSubmissionDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.kyc.createSubmission({
      // Identity from the token, never the body.
      userId: user.sub,
      userRoles: user.roles,
      dto,
    });
  }

  /** GET /api/v1/kyc/submissions/me — the caller's own submissions. */
  @Get('submissions/me')
  @ApiOperation({ summary: "List the caller's own KYC submissions" })
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.kyc.findMySubmissions(user.sub);
  }

  /**
   * POST /api/v1/kyc/aadhaar/otp — ask the verifier to text an OTP.
   * The Aadhaar number is used for this call only; it is never stored.
   */
  @Post('aadhaar/otp')
  @HttpCode(HttpStatus.OK)
  @Throttle(OTP_REQUEST_LIMIT)
  @ApiOperation({ summary: 'Request an Aadhaar OTP' })
  requestAadhaarOtp(@Body() dto: RequestAadhaarOtpDto) {
    return this.kyc.requestAadhaarOtp(dto.aadhaarNumber);
  }

  /**
   * POST /api/v1/kyc/aadhaar/verify — redeem the OTP for a reference id and
   * the last four digits, which is what POST /kyc/submissions expects.
   */
  @Post('aadhaar/verify')
  @HttpCode(HttpStatus.OK)
  @Throttle(OTP_VERIFY_LIMIT)
  @ApiOperation({ summary: 'Verify an Aadhaar OTP' })
  verifyAadhaarOtp(@Body() dto: VerifyAadhaarOtpDto) {
    return this.kyc.verifyAadhaarOtp(dto.txnId, dto.otp);
  }
}
