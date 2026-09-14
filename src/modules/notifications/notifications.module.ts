import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { NotificationsService } from './notifications.service';
import { NotificationsController } from './notifications.controller';
import { NotificationProcessor } from './notification.processor';
import { EmailSender } from './senders/email.sender';
import { SmsSender } from './senders/sms.sender';
import { PushSender } from './senders/push.sender';
import { PrismaModule } from '../../prisma/prisma.module';

/**
 * NOTIFICATION_QUEUE name must match the queue name used in NotificationsService
 * and the @Processor decorator in NotificationProcessor.
 */
export const NOTIFICATION_QUEUE = 'notification';

@Module({
  imports: [
    PrismaModule,
    ConfigModule,
    BullModule.registerQueueAsync({
      name: NOTIFICATION_QUEUE,
      imports:  [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('REDIS_HOST', 'localhost'),
          port: config.get<number>('REDIS_PORT', 6379),
          password: config.get<string>('REDIS_PASSWORD', undefined),
        },
        defaultJobOptions: {
          attempts:    5,
          backoff: { type: 'exponential', delay: 5_000 },
          removeOnComplete: true,
          removeOnFail:     false, // Keep failed jobs for inspection
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationProcessor,
    EmailSender,
    SmsSender,
    PushSender,
  ],
  exports: [
    // Export NotificationsService so other modules (Orders, Appointments,
    // Disputes, Listings) can inject it for enqueueAll() calls.
    NotificationsService,
    BullModule,
  ],
})
export class NotificationsModule {}
