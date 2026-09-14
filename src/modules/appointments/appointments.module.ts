import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule } from '@nestjs/config';
import { AppointmentsController } from './appointments.controller';
import { AppointmentsService, APPOINTMENT_REMINDER_QUEUE } from './appointments.service';
import { TrustPoliciesService } from './trust-policies.service';
import { AppointmentReminderProcessor } from './queues/appointment-reminder.processor';
import { PrismaModule } from '../../prisma/prisma.module';

@Module({
  imports: [
    ConfigModule,
    PrismaModule,
    /**
     * BullModule.forRootAsync is registered once in AppModule.
     * Here we only register the queue name used by this module.
     *
     * APPOINTMENT_REMINDER_QUEUE = 'appointment-reminder'
     */
    BullModule.registerQueue({
      name: APPOINTMENT_REMINDER_QUEUE,
    }),
  ],
  controllers: [AppointmentsController],
  providers: [
    AppointmentsService,
    TrustPoliciesService,
    AppointmentReminderProcessor,
  ],
  exports: [
    /**
     * AppointmentsService is exported so Module 4 (Orders) can call:
     *
     *   const gate = await appointmentsService.isAppointmentCompleted({ ... })
     *   if (gate.required && !gate.completed) throw new ForbiddenException(...)
     *
     * CRITICAL: Module 4 MUST use isAppointmentCompleted(), NOT any
     * isAppointmentConfirmed() variant. Only COMPLETED satisfies the
     * trust-gate. CONFIRMED alone does NOT unlock checkout.
     */
    AppointmentsService,
    TrustPoliciesService,
  ],
})
export class AppointmentsModule {}
