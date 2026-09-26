import { Body, Controller, Post, Req, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

@ApiTags('Orders')
@ApiBearerAuth()
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * POST /orders
   * Places an order. OrdersService applies the trust/inventory/region gates.
   * buyerProfileId is taken from the authenticated token, never the request body.
   */
  @Post()
  @UseGuards(RolesGuard)
  @Roles(UserRole.BUYER)
  @ApiOperation({ summary: 'Place an order (BUYER)' })
  createOrder(@Body() dto: CreateOrderDto, @Req() req: any) {
    return this.ordersService.createOrder(
      req.user.sub,
      dto.listingId,
      dto.quantity,
      dto.appointmentId,
      dto.feeConfigVersionId,
    );
  }
}
