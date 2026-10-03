import { Module } from '@nestjs/common';

import { TrackingController } from './tracking.controller';
import { TrackingService } from './tracking.service';

/**
 * Live vehicle tracking.
 *
 * No `PrismaModule` import, and that is a statement rather than an oversight:
 * the tracking feed is currently generated end to end, so it reads no tables
 * and writes none. When a telematics gateway lands it will need somewhere to
 * put readings, and this module is where that dependency should appear.
 */
@Module({
  controllers: [TrackingController],
  providers: [TrackingService],
  exports: [TrackingService],
})
export class TrackingModule {}
