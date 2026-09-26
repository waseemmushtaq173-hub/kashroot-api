import { Controller, Post, Get, Param, Body, HttpCode, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth } from '@nestjs/swagger';

import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { UserRole } from '../auth/user-role.enum';
import { EscrowService } from './escrow.service';
import { HoldEscrowDto, RefundEscrowDto } from './dto/escrow.dto';

/**
 * Escrow control surface. Every route moves or inspects money, so all are
 * ADMIN-only (PLATFORM_ADMIN / REGIONAL_ADMIN) behind JWT + RolesGuard — these
 * are back-office / service-triggered operations, never buyer/farmer-facing.
 */
@ApiTags('Escrow')
@ApiBearerAuth()
@Controller('escrow')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(UserRole.PLATFORM_ADMIN, UserRole.REGIONAL_ADMIN)
export class EscrowController {
  constructor(private readonly escrow: EscrowService) {}

  /** POST /api/v1/escrow/hold — secure an order's funds in the vault. */
  @Post('hold')
  @HttpCode(200)
  @ApiOperation({ summary: 'Hold order funds in escrow (ADMIN)' })
  hold(@Body() body: HoldEscrowDto) {
    return this.escrow.holdPaymentForOrder(body.orderId);
  }

  /** POST /api/v1/escrow/:orderId/release — pay held funds to the provider. */
  @Post(':orderId/release')
  @HttpCode(200)
  @ApiOperation({ summary: 'Release escrow to provider on completion (ADMIN)' })
  release(@Param('orderId') orderId: string) {
    return this.escrow.releaseEscrowToProvider(orderId);
  }

  /** POST /api/v1/escrow/:orderId/refund — refund held funds to the buyer. */
  @Post(':orderId/refund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refund escrow to buyer (ADMIN)' })
  refund(@Param('orderId') orderId: string, @Body() body: RefundEscrowDto) {
    return this.escrow.refundBuyer(orderId, { refundId: body.refundId, reason: body.reason });
  }

  /** GET /api/v1/escrow/:orderId — hold status + append-only ledger trail. */
  @Get(':orderId')
  @ApiOperation({ summary: 'Read escrow hold + ledger trail for an order (ADMIN)' })
  read(@Param('orderId') orderId: string) {
    return this.escrow.getEscrowForOrder(orderId);
  }
}
