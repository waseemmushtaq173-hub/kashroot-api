import {
  Controller,
  Get,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PrismaService } from '../../prisma/prisma.service';
import { RequestWithUser } from '../../common/types/request-with-user.type';

/**
 * MissedUpdatesController
 *
 * GET /realtime/missed-updates?since=<ISO>&limit=<n>
 *
 * REST fallback for WebSocket reconnect.
 * On reconnect, the client passes the timestamp of its last known update.
 * Returns all updates that arrived while the client was disconnected:
 *   - Order status changes (orders the user is buyer/farmer of)
 *   - Appointment status changes (appointments the user participates in)
 *   - Chat messages for threads the user participates in
 *
 * Participant check is enforced server-side via farmer_profile.user_id /
 * buyer_profile.user_id — the client cannot enumerate others' updates.
 *
 * `since` defaults to 15 minutes ago if omitted.
 * `limit` is capped at 200 per entity type.
 */
@ApiTags('Realtime')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('realtime')
export class MissedUpdatesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('missed-updates')
  @ApiOperation({
    summary: 'Fetch missed updates since a given timestamp (call on socket reconnect)',
    description:
      'Returns order/appointment status changes and chat messages that arrived ' +
      'while the client was disconnected. Pass `since` as ISO-8601; defaults to last 15 minutes.',
  })
  @ApiQuery({ name: 'since', required: false, description: 'ISO-8601 lower bound. Defaults to 15 min ago.' })
  @ApiQuery({ name: 'limit', required: false, description: 'Max rows per entity type. Default 50, max 200.' })
  async getMissedUpdates(
    @Req() req: RequestWithUser,
    @Query('since') since?: string,
    @Query('limit', new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    const userId    = req.user.sub;
    const sinceDate = since ? new Date(since) : new Date(Date.now() - 15 * 60 * 1_000);
    const take      = Math.min(limit ?? 50, 200);

    // Resolve profile IDs for the connected user
    const [buyerProfile, farmerProfile] = await Promise.all([
      this.prisma.buyerProfile.findUnique({ where: { userId }, select: { id: true } }),
      this.prisma.farmerProfile.findUnique({ where: { userId }, select: { id: true } }),
    ]);

    // ── 1. Order updates ──────────────────────────────────────────────────
    const orderOR: any[] = [];
    if (buyerProfile)  orderOR.push({ buyerProfileId:  buyerProfile.id });
    if (farmerProfile) orderOR.push({ farmerProfileId: farmerProfile.id });
    const orders = orderOR.length > 0
      ? await this.prisma.order.findMany({
          where:   { updatedAt: { gte: sinceDate }, OR: orderOR },
          select:  { id: true, status: true, updatedAt: true, buyerProfileId: true, farmerProfileId: true },
          orderBy: { updatedAt: 'desc' },
          take,
        })
      : [];

    // ── 2. Appointment updates ────────────────────────────────────────────
    const apptOR: any[] = [];
    if (buyerProfile)  apptOR.push({ buyerProfileId:  buyerProfile.id });
    if (farmerProfile) apptOR.push({ farmerProfileId: farmerProfile.id });
    const appointments = apptOR.length > 0
      ? await this.prisma.appointment.findMany({
          where:   { updatedAt: { gte: sinceDate }, OR: apptOR },
          select:  { id: true, status: true, updatedAt: true, startTimeUtc: true, buyerProfileId: true, farmerProfileId: true },
          orderBy: { updatedAt: 'desc' },
          take,
        })
      : [];

    // ── 3. Missed chat messages ───────────────────────────────────────────
    // Find threads the user participates in (server-side enforcement)
    const threadOR: any[] = [];
    if (buyerProfile) {
      threadOR.push({ order:       { buyerProfileId:  buyerProfile.id } });
      threadOR.push({ appointment: { buyerProfileId:  buyerProfile.id } });
    }
    if (farmerProfile) {
      threadOR.push({ order:       { farmerProfileId: farmerProfile.id } });
      threadOR.push({ appointment: { farmerProfileId: farmerProfile.id } });
    }
    const threadIds = threadOR.length > 0
      ? (await this.prisma.chatThread.findMany({ where: { OR: threadOR }, select: { id: true } })).map((t) => t.id)
      : [];
    const chatMessages = threadIds.length > 0
      ? await this.prisma.chatMessage.findMany({
          where:   { threadId: { in: threadIds }, createdAt: { gte: sinceDate } },
          select:  { id: true, threadId: true, senderUserId: true, body: true, createdAt: true },
          orderBy: { createdAt: 'desc' },
          take,
        })
      : [];

    return {
      since:        sinceDate.toISOString(),
      orders,
      appointments,
      chatMessages,
      counts: {
        orders:       orders.length,
        appointments: appointments.length,
        chatMessages: chatMessages.length,
      },
    };
  }
}
