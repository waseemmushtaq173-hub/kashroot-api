import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { MandiPricesController } from './mandi-prices.controller';
import { MandiPricesAdminController } from './mandi-prices-admin.controller';
import { MandiPricesService } from './mandi-prices.service';
import { MandiLiveController } from './mandi-live.controller';
import { MandiLiveService } from './mandi-live.service';
import { AgmarknetProvider } from './providers/agmarknet.provider';

/**
 * Two surfaces over one domain:
 *
 *  - `MandiPricesService` reads the persisted APMC benchmark rows that an admin
 *    maintains through the sync endpoint, and writes corrections back.
 *  - `MandiLiveService` serves the location-resolved read-through feed, backed
 *    only by the Agmarknet provider. Hubs without an upstream feed return an
 *    honest empty board rather than generated prices. It writes nothing.
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
  ],
  exports: [MandiPricesService, MandiLiveService],
})
export class MandiPricesModule {}
