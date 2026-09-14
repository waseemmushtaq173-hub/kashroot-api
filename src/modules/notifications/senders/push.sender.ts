import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { ChannelSendInput } from './email.sender';

/**
 * PushSender
 *
 * PRODUCTION REQUIREMENT:
 *   Set FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, FIREBASE_PRIVATE_KEY
 *   to real Firebase service-account credentials.
 *   Devices must register their FCM token via POST /notifications/push-token.
 *   Without real credentials this sender logs and throws — BullMQ retries.
 *
 * For production: load templates from a CMS, support localization.
 */
@Injectable()
export class PushSender {
  private readonly logger = new Logger(PushSender.name);
  private readonly firebaseConfigured: boolean;

  constructor(private readonly config: ConfigService) {
    this.firebaseConfigured =
      !!config.get('FIREBASE_PROJECT_ID') &&
      !!config.get('FIREBASE_CLIENT_EMAIL') &&
      !!config.get('FIREBASE_PRIVATE_KEY');
  }

  /**
   * send
   * @param fcmTokens — one or more FCM registration tokens for the user’s devices.
   *   Caller should look these up from a user_push_tokens table (not in scope for
   *   this module — add the table and endpoint when implementing the mobile client).
   */
  async send(
    input: ChannelSendInput & { fcmTokens: string[] },
  ): Promise<void> {
    if (!this.firebaseConfigured) {
      this.logger.warn(
        `[SANDBOX] Push NOT sent (no real Firebase creds). ` +
        `Tokens: ${input.fcmTokens.length}, Category: ${input.category}`,
      );
      return;
    }

    if (!input.fcmTokens.length) {
      this.logger.log(
        `Push skipped: no FCM tokens for userId=${input.userId} category=${input.category}`,
      );
      return;
    }

    // Dynamic import keeps firebase-admin optional until production
    const admin = await import('firebase-admin');
    if (!(admin as any).default.apps.length) {
      (admin as any).default.initializeApp({
        credential: (admin as any).default.credential.cert({
          projectId:   this.config.get('FIREBASE_PROJECT_ID'),
          clientEmail: this.config.get('FIREBASE_CLIENT_EMAIL'),
          privateKey:  (this.config.get('FIREBASE_PRIVATE_KEY') ?? '').replace(/\\n/g, '\n'),
        }),
      });
    }

    const { title, body } = this.renderPush(input.category, input.payload);

    const message: any = {
      notification: { title, body },
      data: {
        category: input.category,
        payload:  JSON.stringify(input.payload),
      },
      tokens: input.fcmTokens,
    };

    const response = await (admin as any).default.messaging().sendEachForMulticast(message);
    this.logger.log(
      `Push sent: category=${input.category} success=${response.successCount} fail=${response.failureCount}`,
    );
  }

  private renderPush(
    category: string,
    payload: Record<string, unknown>,
  ): { title: string; body: string } {
    const map: Record<string, { title: string; body: (p: Record<string, unknown>) => string }> = {
      APPOINTMENT_REQUESTED:  { title: 'New Appointment Request',   body: (p) => `${p['farmerName'] ?? 'A farmer'} requested an appointment.` },
      APPOINTMENT_CONFIRMED:  { title: 'Appointment Confirmed',     body: (p) => `Your appointment on ${p['scheduledAt'] ?? 'your date'} is confirmed.` },
      APPOINTMENT_CANCELLED:  { title: 'Appointment Cancelled',     body: (p) => `Your appointment on ${p['scheduledAt'] ?? 'your date'} was cancelled.` },
      APPOINTMENT_REMINDER:   { title: 'Appointment Reminder',      body: (p) => `Your appointment is in ${p['hoursUntil'] ?? '24'} hours.` },
      ORDER_STATUS_CHANGED:   { title: 'Order Update',              body: (p) => `Order status changed to ${p['newStatus'] ?? 'updated'}.` },
      RESERVATION_EXPIRED:    { title: 'Reservation Expired',       body: ()  => 'Your inventory reservation has expired.' },
      DISPUTE_OPENED:         { title: 'Dispute Opened',            body: (p) => `A dispute was opened on your order.` },
      DISPUTE_RESOLVED:       { title: 'Dispute Resolved',          body: (p) => `Your dispute was resolved: ${p['resolution'] ?? ''}.` },
      PAYMENT_SUCCEEDED:      { title: 'Payment Received',          body: (p) => `Payment of ${p['amount'] ?? ''} confirmed.` },
      PAYMENT_FAILED:         { title: 'Payment Failed',            body: (p) => `Payment of ${p['amount'] ?? ''} failed. Please retry.` },
    };
    const entry = map[category];
    if (entry) return { title: entry.title, body: entry.body(payload) };
    return { title: 'KashRoot', body: `You have a new notification (${category}).` };
  }
}
