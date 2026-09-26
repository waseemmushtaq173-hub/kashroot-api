import { Controller, Post, Body, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { MandiPricesService } from './mandi-prices.service';
import { RecordMandiPriceDto } from './dto/record-mandi-price.dto';

/**
 * Admin/aggregator surface for maintaining the official mandi price boards.
 * Separate from the public MandiPricesController so it can live under the
 * `admin/` path prefix behind JWT + RolesGuard. There is no dedicated
 * "aggregator" role in this platform, so daily-rate entry is entrusted to
 * platform and regional admins.
 */
@ApiTags('Mandi Prices (Admin)')
@ApiBearerAuth()
@Controller('admin/mandi-prices')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN, UserRole.REGIONAL_ADMIN)
export class MandiPricesAdminController {
  constructor(private readonly mandiPrices: MandiPricesService) {}

  /**
   * POST /api/v1/admin/mandi-prices — record (or correct) today's rate for one
   * commodity at one market board. Returns the resulting listic card.
   */
  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Record a daily mandi rate (ADMIN)' })
  record(@Body() dto: RecordMandiPriceDto) {
    return this.mandiPrices.recordDailyPrice(dto);
  }
}
