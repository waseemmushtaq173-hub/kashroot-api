import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { MandiPricesController } from './mandi-prices.controller';
import { MandiPricesAdminController } from './mandi-prices-admin.controller';
import { MandiPricesService } from './mandi-prices.service';

@Module({
  imports: [PrismaModule],
  controllers: [MandiPricesController, MandiPricesAdminController],
  providers: [MandiPricesService],
  exports: [MandiPricesService],
})
export class MandiPricesModule {}
