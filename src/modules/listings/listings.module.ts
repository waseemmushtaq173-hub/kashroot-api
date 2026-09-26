import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { RbacModule } from '../rbac/rbac.module';

import { ListingsController } from './listings.controller';
import { ListingsService } from './listings.service';
import { ListingsSearchService } from './listings-search.service';

// NOTE: InventoryReservationsService + ReservationExpiryProcessor (BullMQ
// reservation-expiry queue) are intentionally omitted here — they depend on an
// InventoryReservation model that does not yet exist in the Prisma schema.
// Re-add them once that model lands. See tsconfig.json `exclude`.
@Module({
  imports: [
    PrismaModule,
    RbacModule,
  ],
  controllers: [ListingsController],
  providers: [
    ListingsService,
    ListingsSearchService,
  ],
  exports: [
    ListingsService,
    ListingsSearchService,
  ],
})
export class ListingsModule {}
