import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';

import { PrismaModule } from '../../prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingsSearchService } from './listings-search.service';
import {
  InventoryReservationsService,
  RESERVATION_EXPIRY_QUEUE,
} from './inventory-reservations.service';
import { ReservationExpiryProcessor } from './queues/reservation-expiry.processor';

@Module({
  imports: [
    PrismaModule,
    RbacModule,
    ConfigModule,
    BullModule.registerQueue({
      name: RESERVATION_EXPIRY_QUEUE,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: 'exponential', delay: 5000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    }),
  ],
  controllers: [ListingsController],
  providers: [
    ListingsService,
    ListingsSearchService,
    InventoryReservationsService,
    ReservationExpiryProcessor,
  ],
  exports: [
    ListingsService,
    ListingsSearchService,
    InventoryReservationsService,
  ],
})
export class ListingsModule {}
