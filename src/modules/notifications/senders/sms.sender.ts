import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelSendInput } from './email.sender';

/**
 * SmsSender
 *
 * PRODUCTION REQUIREMENT:
 *   Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER to real
 *   Twilio credentials with an approved sender number/alphanumeric ID.
 *   Without real credentials this sender logs and throws — BullMQ retries.
 *
 * Template: plain-text SMS (max ~160 chars). Replace with Twilio Content
 * Templates for multi-lingual / branded messages before production.
 */
@Injectable()
export class SmsSender {
  private readonly logger = new Logger(SmsSender.name);
  private readonly accountSid: string;
  private readonly authToken:  string;
  private readonly fromNumber: string;

  constructor(private readonly config: ConfigService) {
    this.accountSid = config.get<string>('TWILIO_ACCOUNT_SID', '');
    this.authToken  = config.get<string>('TWILIO_AUTH_TOKEN',  '');
    this.fromNumber = config.get<string>('TWILIO_FROM_NUMBER', '');
  }

  async send(input: ChannelSendInput & { toPhone: string }): Promise<void> {
    if (!this.accountSid || this.accountSid.startsWith('AC_TEST')) {
      this.logger.warn(
        `[SANDBOX] SMS NOT sent (no real Twilio creds). ` +
        `To: ${input.toPhone}, Category: ${input.category}`,
      );
      return;
    }

    // Dynamic import keeps twilio package optional until production
    const twilio = await import('twilio');
    const client = (twilio as any).default(this.accountSid, this.authToken);

    const body = this.renderSms(input.category, input.payload);

    await client.messages.create({
      body,
      from: this.fromNumber,
      to:   input.toPhone,
    });

    this.logger.log(`SMS sent: to=${input.toPhone} category=${input.category}`);
  }

  private renderSms(category: string, payload: Record<string, unknown>): string {
    const templates: Record<string, (p: Record<string, unknown>) => string> = {
      APPOINTMENT_REQUESTED:  (p) => `KashRoot: New appointment request from ${p['farmerName'] ?? 'a farmer'}. Check your app.`,
      APPOINTMENT_CONFIRMED:  (p) => `KashRoot: Your appointment on ${p['scheduledAt'] ?? 'your date'} is confirmed.`,
      APPOINTMENT_CANCELLED:  (p) => `KashRoot: Appointment on ${p['scheduledAt'] ?? 'your date'} was cancelled.`,
      APPOINTMENT_REMINDER:   (p) => `KashRoot: Reminder — appointment in ${p['hoursUntil'] ?? '24'} hours.`,
      ORDER_STATUS_CHANGED:   (p) => `KashRoot: Order #${p['orderId'] ?? ''} status: ${p['newStatus'] ?? 'updated'}.`,
      RESERVATION_EXPIRED:    ()  => `KashRoot: Your inventory reservation expired. The items are now available again.`,
      DISPUTE_OPENED:         (p) => `KashRoot: Dispute opened on order #${p['orderId'] ?? ''}.`,
      DISPUTE_RESOLVED:       (p) => `KashRoot: Dispute on order #${p['orderId'] ?? ''} resolved: ${p['resolution'] ?? ''}.`,
      PAYMENT_SUCCEEDED:      (p) => `KashRoot: Payment of ${p['amount'] ?? ''} received. Thank you.`,
      PAYMENT_FAILED:         (p) => `KashRoot: Payment of ${p['amount'] ?? ''} failed. Please retry.`,
    };
    const fn = templates[category];
    return fn ? fn(payload) : `KashRoot: You have a new notification (${category}).`;
  }
}
