import {
  Body,
  Controller,
  Get,
  Param,
  ParseEnumPipe,
  Patch,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { VerificationStatus } from '@prisma/client';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { KycService } from './kyc.service';
import { ReviewKycSubmissionDto } from './dto/review-kyc-submission.dto';

/**
 * Admin-only moderation surface for KYC submissions, modelled on
 * ExpertKycAdminController: these routes decide other people's verification,
 * so they sit behind JWT + RolesGuard for platform and regional admins.
 */
@ApiTags('KYC (Admin)')
@ApiBearerAuth()
@Controller('admin/kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
// SUPER_ADMIN, not UserRole.PLATFORM_ADMIN as ExpertKycAdminController uses:
// PLATFORM_ADMIN has no RoleName counterpart, so it matches no token. See the
// note on the UserRole enum.
@Roles(UserRole.SUPER_ADMIN, UserRole.REGIONAL_ADMIN)
export class KycAdminController {
  constructor(private readonly kyc: KycService) {}

  /**
   * GET /api/v1/admin/kyc/submissions — the review queue.
   * Defaults to PENDING; pass ?status= to read the decided ones.
   */
  @Get('submissions')
  @ApiOperation({ summary: 'List KYC submissions by status (ADMIN)' })
  @ApiQuery({ name: 'status', enum: VerificationStatus, required: false })
  list(
    @Query('status', new ParseEnumPipe(VerificationStatus, { optional: true }))
    status?: VerificationStatus,
  ) {
    return this.kyc.listSubmissions(status ?? VerificationStatus.PENDING);
  }

  /** PATCH /api/v1/admin/kyc/submissions/:id/review — approve or reject. */
  @Patch('submissions/:id/review')
  @ApiOperation({ summary: 'Approve or reject a KYC submission (ADMIN)' })
  review(
    @Param('id') submissionId: string,
    @Body() dto: ReviewKycSubmissionDto,
    @CurrentUser() admin: AuthenticatedUser,
  ) {
    return this.kyc.reviewSubmission({
      submissionId,
      status: dto.status,
      reviewNotes: dto.reviewNotes,
      reviewerId: admin.sub, // admin identity from the token
    });
  }
}
