import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { MandiPricesController } from './mandi-prices.controller';
import { MandiPricesService } from './mandi-prices.service';

@Module({
  imports: [PrismaModule],
  controllers: [MandiPricesController],
  providers: [MandiPricesService],
  exports: [MandiPricesService],
})
export class MandiPricesModule {}
