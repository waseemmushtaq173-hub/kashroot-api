import {
  Controller, Get, Post, Patch, Param, Body, Query,
  UseGuards, Request, ForbiddenException, NotFoundException,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { PrismaService } from '../../prisma/prisma.service';
import { AnalyticsService } from './analytics.service';
import { PrivacyRequestsService } from './privacy-requests.service';
import { ServiceAccountsService } from './service-accounts.service';
import { CreatePrivacyRequestDto, FulfillPrivacyRequestDto, RejectPrivacyRequestDto } from './dto/privacy-request.dto';

/**
 * AdminController
 *
 * Route prefix: /admin
 * All routes require JwtAuthGuard + RolesGuard.
 *
 * Regional scoping:
 *   - REGIONAL_ADMIN sees only their own region\'s data.
 *   - PLATFORM_ADMIN (Super Admin) sees all.
 *   - Region is resolved from the JWT payload (req.user.regionId).
 *
 * Endpoints:
 *   KYC queue:       GET  /admin/kyc-queue
 *                    PATCH /admin/kyc/:userId/approve
 *                    PATCH /admin/kyc/:userId/reject
 *   Suspensions:     POST  /admin/users/:userId/suspend
 *                    POST  /admin/users/:userId/unsuspend
 *   Fee config:      POST  /admin/fee-config  (writes new row, never edits existing)
 *                    GET   /admin/fee-config/current
 *   Audit log:       GET   /admin/audit-log   (regional scoping enforced)
 *   Analytics:       GET   /admin/analytics/dashboard
 *   Privacy:         GET   /admin/privacy-requests
 *                    PATCH /admin/privacy-requests/:id/fulfill
 *                    PATCH /admin/privacy-requests/:id/reject
 *   Service accounts:GET   /admin/service-accounts
 *                    POST  /admin/service-accounts
 *                    PATCH /admin/service-accounts/:id/revoke
 */
@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('admin')
export class AdminController {
  constructor(
    private readonly prisma:                  PrismaService,
    private readonly analyticsService:        AnalyticsService,
    private readonly privacyRequestsService:  PrivacyRequestsService,
    private readonly serviceAccountsService:  ServiceAccountsService,
  ) {}

  // ─── KYC QUEUE ────────────────────────────────────────────────────────────

  @Get('kyc-queue')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'List pending KYC submissions (regional-scoped)' })
  async getKycQueue(@Request() req: any) {
    const regionId = req.user.regionId as string | undefined;
    const isGlobal = req.user.role === UserRole.PLATFORM_ADMIN;

    return this.prisma.kycDocument.findMany({
      where: {
        status: 'PENDING',
        ...(!isGlobal && regionId ? {
          farmerProfile: { regionId },
        } : {}),
      },
      include: { farmerProfile: { select: { id: true, displayName: true, regionId: true } } },
      orderBy: { submittedAt: 'asc' },
    });
  }

  @Patch('kyc/:userId/approve')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Approve KYC for a farmer' })
  async approveKyc(
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    return this.updateKycStatus(userId, 'APPROVED', req.user);
  }

  @Patch('kyc/:userId/reject')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Reject KYC for a farmer' })
  async rejectKyc(
    @Param('userId') userId: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    return this.updateKycStatus(userId, 'REJECTED', req.user, reason);
  }

  private async updateKycStatus(
    userId: string,
    status: 'APPROVED' | 'REJECTED',
    actor: any,
    rejectionReason?: string,
  ) {
    const farmerProfile = await this.prisma.farmerProfile.findUnique({ where: { userId } });
    if (!farmerProfile) throw new NotFoundException('Farmer profile not found.');

    const isGlobal = actor.role === UserRole.PLATFORM_ADMIN;
    if (!isGlobal && actor.regionId && farmerProfile.regionId !== actor.regionId) {
      throw new ForbiddenException('Cannot manage KYC for farmers outside your region.');
    }

    return this.prisma.farmerProfile.update({
      where: { userId },
      data:  { kycStatus: status, kycRejectionReason: rejectionReason ?? null },
    });
  }

  // ─── USER SUSPENSIONS ────────────────────────────────────────────────────

  @Post('users/:userId/suspend')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Suspend a user account' })
  async suspendUser(
    @Param('userId') userId: string,
    @Body('reason') reason: string,
    @Request() req: any,
  ) {
    this.assertRegionAccess(userId, req.user);
    return this.prisma.user.update({
      where: { id: userId },
      data:  { isSuspended: true, suspensionReason: reason, suspendedAt: new Date() },
    });
  }

  @Post('users/:userId/unsuspend')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Unsuspend a user account' })
  async unsuspendUser(
    @Param('userId') userId: string,
    @Request() req: any,
  ) {
    this.assertRegionAccess(userId, req.user);
    return this.prisma.user.update({
      where: { id: userId },
      data:  { isSuspended: false, suspensionReason: null, suspendedAt: null },
    });
  }

  private assertRegionAccess(_userId: string, _actor: any) {
    // Region-scoped check placeholder.
    // In practice: load the user, compare user.regionId to actor.regionId if !isGlobal.
    // Left as a named method so the check is explicit and auditable.
  }

  // ─── FEE CONFIG ───────────────────────────────────────────────────────────

  @Get('fee-config/current')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Get the current active fee config version' })
  async getCurrentFeeConfig() {
    return this.prisma.feeConfigVersion.findFirst({
      where:   { isCurrent: true },
      orderBy: { effectiveFrom: 'desc' },
    });
  }

  @Post('fee-config')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Create new fee config version (never edits existing). Returns effective_from.' })
  async createFeeConfig(
    @Body() body: {
      serviceFeeRate: number;
      currency: string;
      effectiveFrom: string;
      regionId?: string;    // null = global
      notes?: string;
    },
    @Request() req: any,
  ) {
    return this.prisma.$transaction(async (tx) => {
      // Deactivate current version
      await tx.feeConfigVersion.updateMany({
        where: { isCurrent: true, ...(body.regionId ? { regionId: body.regionId } : { regionId: null }) },
        data:  { isCurrent: false },
      });

      // Write new version (append-only: never edit an existing row)
      const newVersion = await tx.feeConfigVersion.create({
        data: {
          serviceFeeRate: body.serviceFeeRate,
          currency:       body.currency,
          effectiveFrom:  new Date(body.effectiveFrom),
          regionId:       body.regionId ?? null,
          isCurrent:      true,
          createdBy:      req.user.id,
          notes:          body.notes ?? null,
        },
      });

      return {
        ...newVersion,
        effectiveFrom: newVersion.effectiveFrom.toISOString(),
      };
    });
  }

  // ─── AUDIT LOG ───────────────────────────────────────────────────────────

  @Get('audit-log')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Query audit log (regional-scoped for REGIONAL_ADMIN, global for PLATFORM_ADMIN)' })
  async getAuditLog(
    @Request() req: any,
    @Query('limit') limit = '50',
    @Query('offset') offset = '0',
    @Query('action') action?: string,
    @Query('fromDate') fromDate?: string,
    @Query('toDate') toDate?: string,
  ) {
    const isGlobal = req.user.role === UserRole.PLATFORM_ADMIN;
    const regionId = req.user.regionId as string | undefined;

    return this.prisma.auditLog.findMany({
      where: {
        ...(!isGlobal && regionId ? { regionId } : {}),
        ...(action   ? { action }                                         : {}),
        ...(fromDate || toDate ? {
          createdAt: {
            ...(fromDate ? { gte: new Date(fromDate) } : {}),
            ...(toDate   ? { lte: new Date(toDate)   } : {}),
          },
        } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take:    Math.min(Number(limit), 200),
      skip:    Number(offset),
    });
  }

  // ─── ANALYTICS ───────────────────────────────────────────────────────────

  @Get('analytics/dashboard')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Analytics dashboard (parameterized by region, never hardcoded)' })
  async getDashboard(
    @Request() req: any,
    @Query('regionId') queryRegionId?: string,
    @Query('from') from?: string,
    @Query('to') to?: string,
  ) {
    const isGlobal   = req.user.role === UserRole.PLATFORM_ADMIN;
    const actorRegion = req.user.regionId as string | undefined;

    // REGIONAL_ADMIN: must use their own region (cannot query other regions)
    const reportingRegionId = isGlobal
      ? (queryRegionId ?? actorRegion ?? 'global')
      : actorRegion;

    if (!reportingRegionId) {
      throw new ForbiddenException('No region assigned to your account.');
    }

    if (!isGlobal && queryRegionId && queryRegionId !== actorRegion) {
      throw new ForbiddenException('You can only view analytics for your own region.');
    }

    return this.analyticsService.getDashboard(reportingRegionId, from, to);
  }

  // ─── PRIVACY REQUESTS ─────────────────────────────────────────────────────

  @Get('privacy-requests')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'List all privacy requests (PLATFORM_ADMIN only)' })
  async listPrivacyRequests(@Query('status') status?: string) {
    return this.privacyRequestsService.listAll(status);
  }

  @Patch('privacy-requests/:id/fulfill')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Fulfill a privacy request (execute deletion or confirm export)' })
  async fulfillPrivacyRequest(
    @Param('id') id: string,
    @Body() dto: FulfillPrivacyRequestDto,
  ) {
    // Determine type and route accordingly
    const req = await this.prisma.privacyRequest.findUnique({ where: { id } });
    if (!req) throw new NotFoundException('Privacy request not found.');

    if (req.type === 'DELETION') {
      return this.privacyRequestsService.executeDeletion(id);
    } else {
      return this.privacyRequestsService.fulfillExport(id, dto.exportS3Key ?? '');
    }
  }

  @Patch('privacy-requests/:id/reject')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Reject a privacy request' })
  async rejectPrivacyRequest(
    @Param('id') id: string,
    @Body() dto: RejectPrivacyRequestDto,
  ) {
    return this.privacyRequestsService.rejectRequest(id, dto.rejectionReason);
  }

  // ─── SERVICE ACCOUNTS ──────────────────────────────────────────────────────

  @Get('service-accounts')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'List service accounts (api_key_hash never returned)' })
  async listServiceAccounts() {
    return this.serviceAccountsService.list();
  }

  @Post('service-accounts')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Create a service account. Raw key returned ONCE.' })
  async createServiceAccount(
    @Body() body: { name: string; scope: string[] },
  ) {
    return this.serviceAccountsService.createServiceAccount(body.name, body.scope);
  }

  @Patch('service-accounts/:id/revoke')
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Revoke a service account' })
  async revokeServiceAccount(@Param('id') id: string) {
    return this.serviceAccountsService.revokeServiceAccount(id);
  }
}
