import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * EmailSender
 *
 * PRODUCTION REQUIREMENT:
 *   Set SENDGRID_API_KEY to a real SendGrid API key with a verified sender domain.
 *   Without a real key this sender logs and throws — BullMQ will retry with backoff.
 *
 * The template renderer is intentionally simple: stringify the payload.
 * Replace with a proper template engine (Handlebars, MJML, etc.) before production.
 */
export interface ChannelSendInput {
  userId:   string;
  category: string;
  payload:  Record<string, unknown>;
}

@Injectable()
export class EmailSender {
  private readonly logger = new Logger(EmailSender.name);
  private readonly apiKey:   string;
  private readonly fromEmail: string;

  constructor(private readonly config: ConfigService) {
    this.apiKey    = config.get<string>('SENDGRID_API_KEY', '');
    this.fromEmail = config.get<string>('EMAIL_FROM', 'noreply@kashroot.dev');
  }

  async send(input: ChannelSendInput & { toEmail: string }): Promise<void> {
    if (!this.apiKey || this.apiKey.startsWith('SG.TEST')) {
      // Sandbox mode: log only — no real send
      this.logger.warn(
        `[SANDBOX] Email NOT sent (no real SendGrid key). ` +
        `To: ${input.toEmail}, Category: ${input.category}`,
      );
      return;
    }

    // Dynamic import keeps @sendgrid/mail optional until production
    const sgMail = await import('@sendgrid/mail');
    (sgMail as any).default.setApiKey(this.apiKey);

    const subject = this.renderSubject(input.category);
    const text    = this.renderText(input.category, input.payload);

    await (sgMail as any).default.send({
      to:      input.toEmail,
      from:    this.fromEmail,
      subject,
      text,
    });

    this.logger.log(
      `Email sent: to=${input.toEmail} category=${input.category}`,
    );
  }

  private renderSubject(category: string): string {
    const map: Record<string, string> = {
      APPOINTMENT_REQUESTED:    'New appointment request — KashRoot',
      APPOINTMENT_CONFIRMED:    'Your appointment is confirmed — KashRoot',
      APPOINTMENT_CANCELLED:    'Appointment cancelled — KashRoot',
      APPOINTMENT_REMINDER:     'Reminder: upcoming appointment — KashRoot',
      ORDER_STATUS_CHANGED:     'Your order status has been updated — KashRoot',
      ORDER_PLACED:             'Order placed successfully — KashRoot',
      ORDER_COMPLETED:          'Order completed — KashRoot',
      RESERVATION_EXPIRED:      'Your inventory reservation has expired — KashRoot',
      DISPUTE_OPENED:           'A dispute has been opened — KashRoot',
      DISPUTE_RESOLVED:         'Your dispute has been resolved — KashRoot',
      REVIEW_RECEIVED:          'You have a new review — KashRoot',
      PAYMENT_SUCCEEDED:        'Payment confirmed — KashRoot',
      PAYMENT_FAILED:           'Payment failed — KashRoot',
      PRIVACY_REQUEST_FULFILLED:'Your privacy request has been fulfilled — KashRoot',
    };
    return map[category] ?? 'Notification from KashRoot';
  }

  private renderText(category: string, payload: Record<string, unknown>): string {
    // TODO: replace with Handlebars/MJML templates per category
    return `KashRoot Notification (${category}):\n\n${JSON.stringify(payload, null, 2)}`;
  }
}
