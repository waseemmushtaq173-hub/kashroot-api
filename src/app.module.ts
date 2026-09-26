import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD, APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { BullModule } from '@nestjs/bullmq';
import { AuthModule } from './modules/auth/auth.module';
import { RbacModule } from './modules/rbac/rbac.module';
import { ListingsModule } from './modules/listings/listings.module';
import { OrdersModule } from './modules/orders/orders.module';
import { AiAssistantModule } from './modules/ai-assistant/ai-assistant.module';
import { ExpertKycModule } from './modules/expert-kyc/expert-kyc.module';
import { PrismaService } from './prisma/prisma.service';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { PermissionsGuard } from './common/guards/permissions.guard';
import { GlobalExceptionFilter } from './common/filters/global-exception.filter';
import { AuditLogInterceptor } from './common/interceptors/audit-log.interceptor';

@Module({
  imports: [
    // Config — loaded first, available everywhere
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),

    // Rate limiting — global via ThrottlerGuard below
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ([
        {
          ttl:   parseInt(config.get('RATE_LIMIT_TTL_MS', '60000')),
          limit: parseInt(config.get('RATE_LIMIT_MAX', '100')),
        },
      ]),
    }),

    // BullMQ — connected to Redis
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
    AiAssistantModule,
    ExpertKycModule,
    // Future modules added here:
    // AppointmentsModule,
    // PaymentsModule, PayoutsModule, ShipmentsModule,
    // DisputesModule, ReviewsModule, NotificationsModule,
    // StorageModule, AdminModule, RealtimeModule,
  ],

  providers: [
    PrismaService,

    // Global rate-limit guard (ThrottlerGuard)
    { provide: APP_GUARD, useClass: ThrottlerGuard },

    // Global JWT auth guard — all routes require auth unless @Public()
    { provide: APP_GUARD, useClass: JwtAuthGuard },

    // Global permissions guard — routes require @RequirePermissions() or are open-after-auth
    { provide: APP_GUARD, useClass: PermissionsGuard },

    // Global exception filter — normalises all error responses
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },

    // Global audit-log interceptor — writes @AuditLog() decorated routes
    { provide: APP_INTERCEPTOR, useClass: AuditLogInterceptor },
  ],
})
export class AppModule {}
