import { Body, Controller, Post } from '@nestjs/common';
import { ApiTags, ApiOperation } from '@nestjs/swagger';

import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('Orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * POST /orders
   * Places an order. OrdersService applies the trust/inventory/region gates.
   */
  @Post()
  @ApiOperation({ summary: 'Place an order' })
  createOrder(@Body() dto: CreateOrderDto) {
    return this.ordersService.createOrder(
      dto.buyerProfileId,
      dto.listingId,
      dto.quantity,
      dto.appointmentId,
      dto.feeConfigVersionId,
    );
  }
}
