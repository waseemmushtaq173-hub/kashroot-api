import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { MandiLiveService } from './mandi-live.service';
import { QueryLiveMandiDto } from './dto/query-live-mandi.dto';

/**
 * The location-resolved mandi board.
 *
 * Deliberately separate from `MandiPricesController`, which serves the
 * persisted APMC benchmark rows an admin maintains. This one is read-through:
 * it resolves a location and answers from an upstream feed, touching no tables.
 * Keeping them apart means a change to how the live feed caches or fails cannot
 * disturb the admin-maintained board.
 */
@ApiTags('Mandi Prices')
@Controller('mandi')
export class MandiLiveController {
  constructor(private readonly mandiLive: MandiLiveService) {}

  /**
   * GET /api/v1/mandi/locations   (global prefix adds /api/v1)
   * The hubs and commodities this feed supports, plus each hub's coverage flag.
   * Public and uncached — it is a static list, and the location selector reads
   * it on mount.
   */
  @Get('locations')
  @Public()
  @ApiOperation({
    summary: 'Hubs and commodities the live mandi feed supports (public)',
  })
  locations() {
    return this.mandiLive.listLocations();
  }

  /**
   * GET /api/v1/mandi?location=punjab&commodity=Apple   (global prefix adds /api/v1)
   * Prices for a named hub, or for the hub nearest a browser fix when `lat` and
   * `lng` are supplied instead. Each response carries the `source` it was
   * served from, so the client can show where the numbers came from.
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'Location-resolved mandi prices (public)' })
  feed(@Query() query: QueryLiveMandiDto) {
    return this.mandiLive.getFeed(query);
  }
}
