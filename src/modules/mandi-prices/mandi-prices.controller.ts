import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { MandiPricesService } from './mandi-prices.service';
import { QueryMandiPricesDto } from './dto/query-mandi-prices.dto';

@ApiTags('Mandi Prices')
@Controller('mandi-prices')
export class MandiPricesController {
  constructor(private readonly mandiPrices: MandiPricesService) {}

  /**
   * GET /api/v1/mandi-prices   (global prefix adds /api/v1)
   * Public, read-only feed of official regulated physical APMC mandi benchmarks,
   * with trend indicators and per-language audio prompts for the voice-first client.
   * Filterable by `regionId` or `mandiName`.
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'Official APMC physical mandi benchmark feed (public)' })
  findAll(@Query() query: QueryMandiPricesDto) {
    return this.mandiPrices.findAll(query);
  }
}
