import { Controller, Get, Post, HttpCode, Query, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { MandiPricesService } from './mandi-prices.service';
import { QueryMandiPricesDto } from './dto/query-mandi-prices.dto';

@ApiTags('Mandi Prices')
@Controller('mandi-prices')
export class MandiPricesController {
  constructor(private readonly mandiPrices: MandiPricesService) {}

  /**
   * GET /api/v1/mandi-prices   (global prefix adds /api/v1)
   * Public, read-only feed of official regulated physical APMC mandi benchmarks,
   * returned as picture-driven listic cards (trend arrow/colour + per-language
   * audio prompts) for the voice-first client. Filterable by `regionId`,
   * `commodity`, or `mandiName`.
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'Official APMC mandi listic price cards (public)' })
  findAll(@Query() query: QueryMandiPricesDto) {
    return this.mandiPrices.findLatestRegionalPrices(query);
  }

  /**
   * POST /api/v1/mandi-prices/sync   (global prefix adds /api/v1)
   * Admin-only: ingest the official Agmarknet / APMC daily bulletin. Not public —
   * this writes to the benchmark feed and is triggered from the Admin Dashboard.
   */
  @Post('sync')
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, RolesGuard)
  @Roles(UserRole.PLATFORM_ADMIN, UserRole.REGIONAL_ADMIN)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Sync official APMC bulletin (ADMIN)' })
  sync() {
    return this.mandiPrices.syncOfficialApmcData();
  }
}
