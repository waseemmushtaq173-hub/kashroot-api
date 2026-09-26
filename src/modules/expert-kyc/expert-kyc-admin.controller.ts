import { Controller, Get, Patch, Param, Body, UseGuards, Req } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { ExpertKycService } from './expert-kyc.service';
import { ApproveRejectKycDto } from './dto/approve-reject-kyc.dto';

/**
 * Admin-only moderation surface for expert KYC. Distinct from the expert-facing
 * ExpertKycController (upload) — these routes verify or reject other people's
 * credentials, so they sit behind JWT + RolesGuard for platform/regional admins.
 */
@ApiTags('Expert KYC (Admin)')
@ApiBearerAuth()
@Controller('admin/experts/kyc')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN, UserRole.REGIONAL_ADMIN)
export class ExpertKycAdminController {
  constructor(private readonly kyc: ExpertKycService) {}

  /** GET /api/v1/admin/experts/kyc/pending — submissions awaiting review. */
  @Get('pending')
  @ApiOperation({ summary: 'List pending expert KYC submissions (ADMIN)' })
  listPending() {
    return this.kyc.findPendingSubmissions();
  }

  /** PATCH /api/v1/admin/experts/kyc/:id/review — approve or reject a submission. */
  @Patch(':id/review')
  @ApiOperation({ summary: 'Approve or reject an expert KYC submission (ADMIN)' })
  review(
    @Param('id') documentId: string,
    @Body() dto: ApproveRejectKycDto,
    @Req() req: any,
  ) {
    return this.kyc.reviewKycDocument({
      documentId,
      status: dto.status,
      reviewNotes: dto.reviewNotes,
      reviewerId: req.user.sub, // admin identity from the token
    });
  }
}
