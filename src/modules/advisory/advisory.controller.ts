import { Controller, Get, Query } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { Public } from '../../common/decorators/public.decorator';
import { AdvisoryService } from './advisory.service';
import { QueryAdvisoryDto } from './dto/query-advisory.dto';

/**
 * Public Spoken Agronomy Knowledge Base feed. Returns verified farming
 * advisories as picture-driven listic cards (English text + per-language spoken
 * clips) for the Farmer Portal knowledge feed. Read-only and unauthenticated.
 */
@ApiTags('Farming Advisories')
@Controller('advisories')
export class AdvisoryController {
  constructor(private readonly advisory: AdvisoryService) {}

  /**
   * GET /api/v1/advisories   (global prefix adds /api/v1)
   * Public knowledge feed, filterable by `category`, `crop`, or `region`.
   */
  @Get()
  @Public()
  @ApiOperation({ summary: 'Verified farming advisories knowledge feed (public)' })
  findAll(@Query() query: QueryAdvisoryDto) {
    return this.advisory.findAdvisories(query);
  }
}
