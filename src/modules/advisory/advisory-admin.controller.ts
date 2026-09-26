import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { AdvisoryService } from './advisory.service';
import { CreateAdvisoryDto } from './dto/create-advisory.dto';

/**
 * Authoring surface for the Spoken Agronomy Knowledge Base. Separate from the
 * public feed so it can live under the `admin/` path behind JWT + RolesGuard.
 * Restricted to platform/regional admins and verified agronomy EXPERTs, who are
 * trusted to publish research-backed guidance farmers will act on.
 */
@ApiTags('Farming Advisories (Admin)')
@ApiBearerAuth()
@Controller('admin/advisories')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN, UserRole.REGIONAL_ADMIN, UserRole.EXPERT)
export class AdvisoryAdminController {
  constructor(private readonly advisory: AdvisoryService) {}

  /** POST /api/v1/admin/advisories — publish one verified advisory. */
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Publish a verified farming advisory (ADMIN/EXPERT)' })
  create(@Body() dto: CreateAdvisoryDto) {
    return this.advisory.createAdvisory(dto);
  }

  /** POST /api/v1/admin/advisories/seed — seed the baseline J&K advisories. */
  @Post('seed')
  @HttpCode(200)
  @ApiOperation({ summary: 'Seed baseline SKUAST-K advisories (ADMIN/EXPERT)' })
  seed() {
    return this.advisory.seedInitialAdvisories();
  }
}
