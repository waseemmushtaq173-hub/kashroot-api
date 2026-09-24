import {
  Controller, Post, Get, Patch, Param, Body, UseGuards, Request,
  ForbiddenException, UploadedFile, UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiConsumes } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { RecommendDisputeDto, ResolveDisputeDto } from './dto/resolve-dispute.dto';

/**
 * DisputesController — /disputes
 *
 * Regional authority is enforced in DisputesService.resolve().
 * The controller passes actorRegionId + actorIsGlobal from the JWT payload.
 *
 * recommend:  SUPPORT_MODERATOR, REGIONAL_ADMIN (cross-border dest), PLATFORM_ADMIN
 * resolve:    REGIONAL_ADMIN (operational region only), PLATFORM_ADMIN
 */
@ApiTags('disputes')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('disputes')
export class DisputesController {
  constructor(private readonly disputesService: DisputesService) {}

  @Post()
  @ApiOperation({ summary: 'Open a dispute for an order' })
  async create(@Request() req: any, @Body() dto: CreateDisputeDto) {
    return this.disputesService.create(req.user.id, dto);
  }

  @Get(':disputeId')
  @ApiOperation({ summary: 'Load a dispute + evidence' })
  async load(@Param('disputeId') disputeId: string) {
    return this.disputesService.loadDispute(disputeId);
  }

  @Get('region/:regionId')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'List disputes for a region (operational_region_id)' })
  async listByRegion(@Param('regionId') regionId: string, @Request() req: any) {
    const isGlobal   = req.user.role === UserRole.PLATFORM_ADMIN;
    const actorRegion = req.user.regionId as string | undefined;

    // REGIONAL_ADMIN cannot query other regions
    if (!isGlobal && actorRegion && regionId !== actorRegion) {
      throw new ForbiddenException('You can only view disputes for your own region.');
    }

    return this.disputesService.listByRegion(regionId);
  }

  @Get()
  @Roles(UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'PLATFORM_ADMIN: list all disputes' })
  async listAll() {
    return this.disputesService.listAll();
  }

  @Patch(':disputeId/recommend')
  @Roles(UserRole.SUPPORT_MODERATOR, UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Submit a recommendation (does not resolve). Allowed: SUPPORT_MODERATOR, destination-region REGIONAL_ADMIN (cross-border), PLATFORM_ADMIN.' })
  async recommend(
    @Param('disputeId') disputeId: string,
    @Body() dto: RecommendDisputeDto,
    @Request() req: any,
  ) {
    return this.disputesService.recommend(disputeId, req.user.id, dto);
  }

  @Patch(':disputeId/resolve')
  @Roles(UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Resolve a dispute. REGIONAL_ADMIN: operational region only. PLATFORM_ADMIN: global.' })
  async resolve(
    @Param('disputeId') disputeId: string,
    @Body() dto: ResolveDisputeDto,
    @Request() req: any,
  ) {
    const isGlobal     = req.user.role === UserRole.PLATFORM_ADMIN;
    const actorRegionId = req.user.regionId as string | null ?? null;
    return this.disputesService.resolve(disputeId, req.user.id, actorRegionId, isGlobal, dto);
  }

  @Post(':disputeId/evidence')
  @ApiConsumes('multipart/form-data')
  @UseInterceptors(FileInterceptor('file'))
  @ApiOperation({ summary: 'Upload evidence for a dispute (S3 signed-URL pattern)' })
  async addEvidence(
    @Param('disputeId') disputeId: string,
    @UploadedFile() file: any,
    @Body('description') description: string,
    @Request() req: any,
  ) {
    // In production: upload file to S3, get s3Key
    // Here: assume s3Key is passed or derived from file.originalname for DI simplicity
    const s3Key    = `disputes/${disputeId}/${Date.now()}-${file.originalname}`;
    const mimeType = file.mimetype;
    const sizeBytes = file.size;

    return this.disputesService.addEvidence(disputeId, req.user.id, { s3Key, mimeType, sizeBytes, description });
  }

  @Get(':disputeId/evidence')
  @ApiOperation({ summary: 'List evidence for a dispute' })
  async listEvidence(@Param('disputeId') disputeId: string) {
    return this.disputesService.listEvidence(disputeId);
  }
}
