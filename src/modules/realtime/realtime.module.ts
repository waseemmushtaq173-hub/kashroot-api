import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { RealtimeGateway } from './realtime.gateway';
import { MissedUpdatesController } from './missed-updates.controller';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * RealtimeModule
 *
 * Provides:
 *   - RealtimeGateway   — socket.io WebSocket gateway
 *     * JWT auth on every socket connection (same secret as REST JwtAuthGuard)
 *     * subscribe:thread verified server-side before joining room
 *     * Emits: order:update, appointment:update, chat:message
 *
 *   - MissedUpdatesController — GET /realtime/missed-updates
 *     * REST fallback for clients that need updates missed during disconnect
 *     * Participant-scoped: only returns the connected user's own orders/appts/threads
 *
 * Exports RealtimeGateway so OrdersModule, AppointmentsModule, and
 * DisputesModule can inject it to push real-time events after DB writes.
 *
 * Add RealtimeModule to AppModule imports to activate.
 */
@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    // JwtModule used by RealtimeGateway to verify handshake tokens.
    // Must use the same secret as Module 1's JwtAuthGuard.
    JwtModule.registerAsync({
      imports:    [ConfigModule],
      useFactory: (config: ConfigService) => ({
        secret:      config.get<string>('JWT_SECRET'),
        signOptions: { expiresIn: config.get<string>('JWT_EXPIRES_IN', '15m') },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [MissedUpdatesController],
  providers:   [RealtimeGateway],
  exports:     [RealtimeGateway],
})
export class RealtimeModule {}
