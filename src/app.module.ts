import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { ScheduleModule } from '@nestjs/schedule';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './modules/auth/auth.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { ListingsModule } from './modules/listings/listings.module';
import { OrdersModule } from './modules/orders/orders.module';
// import { AppointmentsModule } from './modules/appointments/appointments.module'; // Temporarily commented out
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module';
import { ExpertKycModule } from './modules/expert-kyc/expert-kyc.module';
import { MandiPricesModule } from './modules/mandi-prices/mandi-prices.module';
import { EscrowModule } from './modules/escrow/escrow.module';
import { AgroGuardTesterModule } from './modules/agroguard-tester/agroguard-tester.module';
// import { AdvisoryModule } from './modules/advisory/advisory.module'; // Temporarily commented out
import { PrismaService } from './prisma/prisma.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([
        {
          ttl:   parseInt(config.get('RATE_LIMIT_TTL_MS', '60000')),
          limit: parseInt(config.get('RATE_LIMIT_MAX', '100')),
        },
      ]),
    }),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        connection: { url: config.getOrThrow('REDIS_URL') },
      }),
    }),

    // Feature modules
    AuthModule,
    RbacModule,
    ListingsModule,
    OrdersModule,
    // AppointmentsModule,
    AiAssistantModule,
    ExpertKycModule,
    MandiPricesModule,
    EscrowModule,
    AgroGuardTesterModule,
    // AdvisoryModule,
  ],

  providers: [
    PrismaService,
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}