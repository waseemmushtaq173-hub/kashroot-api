import { Module }    from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';

// Internal services
import { OrdersController }              from './orders.controller';
import { OrdersService }                 from './orders.service';
import { RegionPairEnablementService }   from './region-pair-enablement.service';
import { PricingSnapshotService }        from './pricing-snapshot.service';
import { TradeDirectionService }         from './trade-direction.service';
import { PaymentsService }              from './payments.service';
import { LedgerService }                from './ledger.service';

// Cross-module dependencies
import { AppointmentsModule }           from '../appointments/appointments.module';
import { ListingsModule }               from '../listings/listings.module';

/**
 * OrdersModule
 *
 * Providers:
 *   - OrdersService          — creation flow (trust-gate → region-pair → reservation → snapshot → insert)
 *   - RegionPairEnablementService — HARD route gate with 5-min cache
 *   - PricingSnapshotService  — calculate + writeSnapshot (write-once)
 *   - TradeDirectionService   — getTradeDirection() + isCrossBorder() (never stored on order)
 *   - PaymentsService         — initiate + Razorpay webhook handler (idempotency + sig verification + dedup)
 *   - LedgerService           — append-only; no updateEntry/deleteEntry
 *
 * Imports:
 *   - AppointmentsModule — provides AppointmentsService (isAppointmentCompleted trust-gate)
 *                          and TrustPoliciesService (requiresAppointment check)
 *   - ListingsModule     — provides InventoryReservationsService (commitReservation, Module 2 pipeline)
 *
 * NOTE: The Razorpay webhook endpoint (POST /orders/payments/webhooks/razorpay)
 * needs raw body access. Add in main.ts:
 *   app.use('/orders/payments/webhooks/razorpay', express.raw({ type: '*\/*' }))
 * before app.useGlobalPipes() to prevent JSON parsing interfering with signature verification.
 */
@Module({
  imports: [
    PrismaModule,
    AppointmentsModule,   // provides AppointmentsService + TrustPoliciesService
    ListingsModule,       // provides InventoryReservationsService
  ],
  controllers: [
    OrdersController,
  ],
  providers: [
    OrdersService,
    RegionPairEnablementService,
    PricingSnapshotService,
    TradeDirectionService,
    PaymentsService,
    LedgerService,
  ],
  exports: [
    OrdersService,         // exported for Module 5 (Admin analytics, disputes)
    LedgerService,         // exported for refund approval flow + future payout module
    TradeDirectionService, // exported for regional dashboard module
    RegionPairEnablementService, // exported for admin route management
  ],
})
export class OrdersModule {}
