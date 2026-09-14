import {
  Controller,
  Post,
  Patch,
  Get,
  Body,
  Param,
  ParseUUIDPipe,
  UseGuards,
  Req,
  Headers,
  RawBodyRequest,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation, ApiParam } from '@nestjs/swagger';
import { Request } from 'express';
import { JwtAuthGuard }   from '../auth/guards/jwt-auth.guard';
import { RolesGuard }     from '../auth/guards/roles.guard';
import { Roles }          from '../auth/decorators/roles.decorator';
import { OrdersService }  from './orders.service';
import { PaymentsService } from './payments.service';
import { TradeDirectionService } from './trade-direction.service';
import { CreateOrderDto }        from './dto/create-order.dto';
import { UpdateOrderStatusDto }  from './dto/update-order-status.dto';
import { InitiateRefundDto, ApproveRefundDto } from './dto/refund-order.dto';

@ApiTags('Orders')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders:        OrdersService,
    private readonly payments:      PaymentsService,
    private readonly tradeDirection: TradeDirectionService,
  ) {}

  // ───────────────────────────────────────────────────────────────
  // ORDERS ─ Create & Read
  // ───────────────────────────────────────────────────────────────

  /**
   * POST /orders
   * BUYER places an order.
   *
   * Service applies gates in order (all server-side, regardless of frontend state):
   *   1. isAppointmentCompleted() trust-gate (NOT isAppointmentConfirmed)
   *   2. Region-pair enablement (hard reject if route absent or enabled=false)
   *   3. Inventory reservation commit (Module 2 pipeline)
   *   4. Pricing snapshot write (write-once)
   *   5. Order row insert
   */
  @Post()
  @Roles('BUYER')
  @ApiOperation({ summary: 'Place an order (BUYER)' })
  createOrder(
    @Req()  req: Request & { user: { sub: string } },
    @Body() dto: CreateOrderDto,
  ) {
    return this.orders.create(req.user.sub, dto);
  }

  /**
   * GET /orders/:id
   * Load order with pricing snapshot, payments, refunds, customs docs.
   * FARMER who owns the listing or BUYER who placed the order.
   */
  @Get(':id')
  @Roles('BUYER', 'FARMER', 'SUPPORT_MODERATOR', 'REGIONAL_ADMIN', 'PLATFORM_ADMIN')
  @ApiOperation({ summary: 'Load a single order' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  getOrder(@Param('id', ParseUUIDPipe) id: string) {
    return this.orders.loadOrder(id);
  }

  /**
   * GET /orders/my/buyer
   * List orders placed by the calling BUYER.
   */
  @Get('my/buyer')
  @Roles('BUYER')
  @ApiOperation({ summary: 'List orders placed by the calling buyer' })
  listMyBuyerOrders(
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.orders.listByBuyer(req.user.sub);
  }

  /**
   * GET /orders/my/farmer
   * List orders received by the calling FARMER.
   */
  @Get('my/farmer')
  @Roles('FARMER')
  @ApiOperation({ summary: 'List orders received by the calling farmer' })
  listMyFarmerOrders(
    @Req() req: Request & { user: { sub: string } },
  ) {
    return this.orders.listByFarmer(req.user.sub);
  }

  // ───────────────────────────────────────────────────────────────
  // STATUS TRANSITIONS
  // ───────────────────────────────────────────────────────────────

  /**
   * PATCH /orders/:id/status
   * Transition order status. Service validates allowed transitions.
   * CUSTOMS_CLEARANCE only valid when order.is_cross_border=true.
   */
  @Patch(':id/status')
  @Roles('FARMER', 'SUPPORT_MODERATOR', 'REGIONAL_ADMIN', 'PLATFORM_ADMIN')
  @ApiOperation({ summary: 'Update order status (FARMER / admin roles)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  updateStatus(
    @Param('id', ParseUUIDPipe)       id: string,
    @Req()                             req: Request & { user: { sub: string } },
    @Body()                            dto: UpdateOrderStatusDto,
  ) {
    return this.orders.updateStatus(id, req.user.sub, dto);
  }

  // ───────────────────────────────────────────────────────────────
  // PAYMENTS
  // ───────────────────────────────────────────────────────────────

  /**
   * POST /orders/:id/payments
   * Initiate a payment intent (idempotent via idempotency_key from CreateOrderDto).
   */
  @Post(':id/payments')
  @Roles('BUYER')
  @ApiOperation({ summary: 'Initiate payment for an order (BUYER)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  initiatePayment(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Body() body: { idempotencyKey: string; provider: 'RAZORPAY' | 'STRIPE'; amount: number; currency: string },
  ) {
    return this.payments.initiatePayment({
      orderId,
      idempotencyKey: body.idempotencyKey,
      provider:       body.provider,
      amount:         body.amount,
      currency:       body.currency,
    });
  }

  /**
   * POST /payments/webhooks/razorpay
   * Public endpoint (no JWT guard — Razorpay cannot authenticate).
   * Signature verified inside PaymentsService.handleRazorpayWebhook() BEFORE payload is parsed.
   * Requires raw body access: app.use('/orders/payments/webhooks/razorpay', express.raw({ type: '*/*' }))
   * configured in main.ts or the module.
   */
  @Post('payments/webhooks/razorpay')
  @UseGuards()  // override class-level guard — webhooks are publicly accessible
  @ApiOperation({ summary: 'Razorpay webhook receiver (public — signature-verified internally)' })
  razorpayWebhook(
    @Req()     req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string,
  ) {
    const rawBody = req.rawBody;
    if (!rawBody) throw new Error('Raw body not available. Configure express.raw() for this route in main.ts.');
    return this.payments.handleRazorpayWebhook(rawBody, signature);
  }

  // ───────────────────────────────────────────────────────────────
  // REFUNDS
  // ───────────────────────────────────────────────────────────────

  /**
   * POST /orders/:id/refunds
   * BUYER initiates a refund request. Separate from payments.status.
   * Approval is a separate PATCH /orders/:id/refunds/:refundId/approve.
   */
  @Post(':id/refunds')
  @Roles('BUYER', 'SUPPORT_MODERATOR')
  @ApiOperation({ summary: 'Initiate a refund request (BUYER or SUPPORT_MODERATOR)' })
  @ApiParam({ name: 'id', type: 'string', format: 'uuid' })
  initiateRefund(
    @Param('id', ParseUUIDPipe) orderId: string,
    @Req()  req: Request & { user: { sub: string } },
    @Body() dto: InitiateRefundDto,
  ) {
    // Refund service implementation will be wired here.
    // Stubbed for now — returns 501 until RefundService is implemented.
    return { stub: true, message: 'Refund initiation: implement RefundService.initiate() in next iteration.', orderId, dto };
  }

  /**
   * PATCH /orders/:orderId/refunds/:refundId/approve
   * SUPPORT_MODERATOR or REGIONAL_ADMIN approves or rejects refund.
   * On APPROVED: triggers provider refund call + ledger offsetting entries.
   */
  @Patch(':orderId/refunds/:refundId/approve')
  @Roles('SUPPORT_MODERATOR', 'REGIONAL_ADMIN', 'PLATFORM_ADMIN')
  @ApiOperation({ summary: 'Approve or reject a refund (SUPPORT_MODERATOR / REGIONAL_ADMIN)' })
  approveRefund(
    @Param('orderId',  ParseUUIDPipe) orderId:  string,
    @Param('refundId', ParseUUIDPipe) refundId: string,
    @Req()  req: Request & { user: { sub: string } },
    @Body() dto: ApproveRefundDto,
  ) {
    return { stub: true, message: 'Refund approval: implement RefundService.approve() in next iteration.', orderId, refundId, dto };
  }

  // ───────────────────────────────────────────────────────────────
  // TRADE DIRECTION (utility for dashboards)
  // ───────────────────────────────────────────────────────────────

  /**
   * GET /orders/:id/trade-direction?perspectiveRegionId=IN-JK
   * Returns the trade direction of an order from the perspective of a given region.
   * Used by regional dashboards to display EXPORT_FROM / IMPORT_TO / DOMESTIC_OTHER.
   * trade_direction is NOT stored on the order — always derived at read time.
   */
  @Get(':id/trade-direction')
  @Roles('FARMER', 'BUYER', 'REGIONAL_ADMIN', 'PLATFORM_ADMIN')
  @ApiOperation({ summary: 'Get trade direction relative to a region (derived at read time, never stored)' })
  async getTradeDirection(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: Request & { query: { perspectiveRegionId: string } },
  ) {
    const order     = await this.orders.loadOrder(id);
    const regionId  = (req as any).query.perspectiveRegionId as string;
    const direction = this.tradeDirection.getTradeDirection(
      { originRegionId: order.originRegionId, destinationRegionId: order.destinationRegionId, isCrossBorder: order.isCrossBorder },
      regionId,
    );
    return { orderId: id, perspectiveRegionId: regionId, tradeDirection: direction, isCrossBorder: order.isCrossBorder };
  }
}
