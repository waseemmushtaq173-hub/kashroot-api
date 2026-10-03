import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { MandiPricesController } from './mandi-prices.controller';
import { MandiPricesAdminController } from './mandi-prices-admin.controller';
import { MandiPricesService } from './mandi-prices.service';
import { MandiLiveController } from './mandi-live.controller';
import { MandiLiveService } from './mandi-live.service';
import { AgmarknetProvider } from './providers/agmarknet.provider';
import { SimulatedProvider } from './providers/simulated.provider';

/**
 * Two surfaces over one domain:
 *
 *  - `MandiPricesService` reads the persisted APMC benchmark rows that an admin
 *    maintains through the sync endpoint, and writes corrections back.
 *  - `MandiLiveService` serves the location-resolved read-through feed, backed
 *    by the Agmarknet provider where an upstream exists and by the deterministic
 *    generator where it does not. It writes nothing.
 *
 * ConfigService is injected into the Agmarknet provider; ConfigModule is
 * registered globally in AppModule, so it needs no import here.
 */
@Module({
  imports: [PrismaModule],
  controllers: [
    MandiPricesController,
    MandiPricesAdminController,
    MandiLiveController,
  ],
  providers: [
    MandiPricesService,
    MandiLiveService,
    AgmarknetProvider,
    SimulatedProvider,
  ],
  exports: [MandiPricesService, MandiLiveService],
})
export class MandiPricesModule {}
