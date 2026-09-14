import {
  Injectable,
  Logger,
  BadRequestException,
  ConflictException,
  InternalServerErrorException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LedgerService } from './ledger.service';
import { createHmac, timingSafeEqual } from 'crypto';

/**
 * PaymentsService
 *
 * Responsibilities:
 *   1. Initiate a payment intent (idempotent via idempotency_key).
 *   2. Handle provider webhooks with:
 *      a) Signature verification (stub for Razorpay — replace secret with env var)
 *      b) provider_ref deduplication (if same event delivered twice, no-op)
 *      c) Ledger entry on success (CREDIT to farmer, confirmation status update)
 *
 * Idempotency contract:
 *   - payments.idempotency_key has a UNIQUE constraint in the DB.
 *   - If the same key is submitted twice, ConflictException is thrown.
 *   - Clients should generate a UUID per payment ATTEMPT and reuse it on retries.
 *
 * Webhook dedup contract:
 *   - payments.(provider, provider_ref) has a partial UNIQUE index WHERE provider_ref IS NOT NULL.
 *   - On webhook receipt: check if a payment row with this provider_ref already exists.
 *   - If yes: log and return 200 (idempotent ack). Do NOT double-write ledger entries.
 *   - If no: process event, update payment row, write ledger entry.
 *
 * Signature verification:
 *   - RAZORPAY_WEBHOOK_SECRET must be set in env.
 *   - Signatures are verified with HMAC-SHA256 before any business logic runs.
 *   - Use timingSafeEqual to prevent timing attacks.
 *   - If signature fails: throw UnauthorizedException (return 401 to provider).
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);

  constructor(
    private readonly prisma:  PrismaService,
    private readonly ledger:  LedgerService,
  ) {}

  // ───────────────────────────────────────────────────────────────
  // INITIATE PAYMENT
  // ───────────────────────────────────────────────────────────────

  /**
   * initiatePayment
   *
   * Creates a payment row in PENDING state.
   * Idempotent: if idempotency_key already exists, throws ConflictException.
   * The client should use the returned paymentId to create the provider-side payment intent.
   *
   * @param orderId          - Order to pay for
   * @param amount           - Must match order_pricing_snapshot.total
   * @param currency         - Must match order currency
   * @param idempotencyKey   - Unique per payment attempt (UUID recommended)
   * @param provider         - 'RAZORPAY' | 'STRIPE'
   */
  async initiatePayment({
    orderId,
    amount,
    currency,
    idempotencyKey,
    provider,
  }: {
    orderId:        string;
    amount:         number;
    currency:       string;
    idempotencyKey: string;
    provider:       'RAZORPAY' | 'STRIPE';
  }) {
    // Guard: check idempotency key uniqueness before attempting insert
    const existing = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });
    if (existing) {
      throw new ConflictException(
        `A payment with idempotency key "${idempotencyKey}" already exists (status: ${existing.status}). ` +
        `Use a new idempotency key for a new payment attempt.`,
      );
    }

    // Verify order exists and is in a payable state
    const order = await this.prisma.order.findUnique({
      where:   { id: orderId },
      include: { pricingSnapshot: true },
    });
    if (!order) throw new BadRequestException(`Order ${orderId} not found.`);
    if (order.status !== 'PLACED' && order.status !== 'CONFIRMED') {
      throw new BadRequestException(
        `Order is in status ${order.status}. Payment can only be initiated for PLACED or CONFIRMED orders.`,
      );
    }

    // Verify amount matches snapshot (prevent under/over-payment)
    const snapshotTotal = Number(order.pricingSnapshot?.total ?? 0);
    if (Math.abs(amount - snapshotTotal) > 0.0001) {
      throw new BadRequestException(
        `Payment amount ${amount} does not match order total ${snapshotTotal}. ` +
        `Always use the order's pricing snapshot total.`,
      );
    }

    const payment = await this.prisma.payment.create({
      data: {
        orderId,
        provider,
        amount,
        currency,
        status:         'PENDING',
        idempotencyKey,
        providerRef:    null, // set on webhook success
      },
    });

    this.logger.log(`Payment ${payment.id} initiated for order ${orderId} | provider=${provider} amount=${amount} ${currency}`);
    return payment;
  }

  // ───────────────────────────────────────────────────────────────
  // RAZORPAY WEBHOOK HANDLER
  // ───────────────────────────────────────────────────────────────

  /**
   * handleRazorpayWebhook
   *
   * Called by OrdersController POST /payments/webhooks/razorpay
   * Raw body MUST be passed (not parsed JSON) for signature verification.
   *
   * Dedup guarantee:
   *   If provider_ref is already in DB, we return early (no double-processing).
   *   This handles Razorpay’s at-least-once delivery guarantee safely.
   *
   * @param rawBody   - Raw Buffer from the HTTP request (before JSON.parse)
   * @param signature - Value of X-Razorpay-Signature header
   */
  async handleRazorpayWebhook(rawBody: Buffer, signature: string): Promise<{ processed: boolean }> {
    // 1. Verify signature BEFORE trusting any payload content
    this.verifyRazorpaySignature(rawBody, signature);

    // 2. Parse payload (safe to parse now that signature is verified)
    let payload: RazorpayWebhookPayload;
    try {
      payload = JSON.parse(rawBody.toString('utf8')) as RazorpayWebhookPayload;
    } catch {
      throw new BadRequestException('Invalid JSON in webhook payload.');
    }

    const event       = payload.event;
    const providerRef = payload.payload?.payment?.entity?.id;

    if (!providerRef) {
      this.logger.warn(`Razorpay webhook received without payment ID: event=${event}`);
      return { processed: false };
    }

    // 3. Dedup: check if this provider_ref has already been processed
    const existingPayment = await this.prisma.payment.findFirst({
      where: { provider: 'RAZORPAY', providerRef },
    });

    if (existingPayment && existingPayment.status !== 'PENDING') {
      this.logger.log(
        `Razorpay webhook dedup: event=${event} providerRef=${providerRef} already processed (status=${existingPayment.status}). Returning 200.`,
      );
      return { processed: false }; // idempotent ack — no double-processing
    }

    // 4. Route by event type
    switch (event) {
      case 'payment.captured':
        await this.handlePaymentCaptured(providerRef, payload);
        break;

      case 'payment.failed':
        await this.handlePaymentFailed(providerRef);
        break;

      default:
        this.logger.log(`Razorpay webhook: unhandled event type "${event}" — acknowledged.`);
        return { processed: false };
    }

    return { processed: true };
  }

  // ───────────────────────────────────────────────────────────────
  // PRIVATE — WEBHOOK EVENT HANDLERS
  // ───────────────────────────────────────────────────────────────

  private async handlePaymentCaptured(
    providerRef: string,
    payload:     RazorpayWebhookPayload,
  ): Promise<void> {
    const entityAmount   = payload.payload?.payment?.entity?.amount ?? 0;
    const entityCurrency = payload.payload?.payment?.entity?.currency ?? 'INR';
    // Razorpay sends amount in paise (smallest unit); convert to main unit
    const amountInMainUnit = entityAmount / 100;

    // Find the pending payment by order_id if we have it, otherwise by matching amount
    // In practice, orderId is stored in Razorpay notes at payment intent creation
    const orderId = payload.payload?.payment?.entity?.notes?.orderId;

    if (!orderId) {
      this.logger.error(`Razorpay payment.captured: no orderId in notes for providerRef=${providerRef}`);
      throw new InternalServerErrorException('Cannot process payment: no orderId in webhook notes.');
    }

    await this.prisma.$transaction(async (tx) => {
      // Update payment row with providerRef and CAPTURED status
      await tx.payment.updateMany({
        where: { orderId, status: 'PENDING', providerRef: null },
        data:  { providerRef, status: 'CAPTURED' },
      });

      // Update order to CONFIRMED
      await tx.order.update({
        where: { id: orderId },
        data:  { status: 'CONFIRMED' },
      });

      // Lookup farmer and buyer profile IDs from the order
      const order = await tx.order.findUnique({ where: { id: orderId } });
      if (!order) throw new InternalServerErrorException(`Order ${orderId} not found during payment capture.`);

      // Write ledger CREDIT to farmer (pending payout)
      await this.ledger.appendEntry(tx, {
        farmerProfileId: order.farmerProfileId,
        buyerProfileId:  null,
        entryType:       'CREDIT',
        amount:          amountInMainUnit,
        currency:        entityCurrency,
        relatedOrderId:  orderId,
        relatedRefundId: null,
        description:     `Payment CAPTURED: providerRef=${providerRef}`,
      });
    });

    this.logger.log(
      `Payment captured: providerRef=${providerRef} order=${orderId} amount=${amountInMainUnit} ${entityCurrency}`,
    );
  }

  private async handlePaymentFailed(providerRef: string): Promise<void> {
    // Mark any pending payments that were awaiting this ref as FAILED
    await this.prisma.payment.updateMany({
      where: { providerRef, status: 'PENDING' },
      data:  { status: 'FAILED' },
    });
    this.logger.warn(`Payment failed: providerRef=${providerRef}`);
  }

  // ───────────────────────────────────────────────────────────────
  // PRIVATE — SIGNATURE VERIFICATION
  // ───────────────────────────────────────────────────────────────

  /**
   * verifyRazorpaySignature
   *
   * Razorpay signs webhooks with HMAC-SHA256 using the webhook secret.
   * The signature is in the X-Razorpay-Signature header.
   *
   * MUST be called before parsing or trusting any payload content.
   * Uses timingSafeEqual to prevent timing-based signature bypass attacks.
   *
   * @param rawBody   - Raw Buffer (not parsed JSON)
   * @param signature - Hex string from X-Razorpay-Signature header
   * @throws UnauthorizedException if signature is missing or invalid
   */
  private verifyRazorpaySignature(rawBody: Buffer, signature: string): void {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) {
      // In production this must never happen — fail hard
      throw new InternalServerErrorException(
        'RAZORPAY_WEBHOOK_SECRET is not configured. Cannot verify webhook signature.',
      );
    }

    if (!signature) {
      throw new UnauthorizedException('Missing X-Razorpay-Signature header.');
    }

    const expectedSig = createHmac('sha256', secret)
      .update(rawBody)
      .digest('hex');

    const expectedBuf = Buffer.from(expectedSig,  'hex');
    const receivedBuf = Buffer.from(signature,    'hex');

    // timingSafeEqual requires same-length buffers
    if (
      expectedBuf.length !== receivedBuf.length ||
      !timingSafeEqual(expectedBuf, receivedBuf)
    ) {
      this.logger.warn('Razorpay webhook signature verification FAILED.');
      throw new UnauthorizedException('Invalid webhook signature.');
    }
  }
}

// ───────────────────────────────────────────────────────────────
// RAZORPAY WEBHOOK PAYLOAD TYPES (minimal, extend as needed)
// ───────────────────────────────────────────────────────────────

interface RazorpayPaymentEntity {
  id:       string;     // e.g. "pay_abc123"
  amount:   number;     // in paise
  currency: string;     // e.g. "INR"
  status:   string;     // "captured" | "failed"
  notes?: {
    orderId?: string;   // set at payment creation time
    [key: string]: unknown;
  };
}

interface RazorpayWebhookPayload {
  event:    string;     // e.g. "payment.captured"
  payload?: {
    payment?: {
      entity?: RazorpayPaymentEntity;
    };
  };
}
