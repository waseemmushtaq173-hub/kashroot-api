import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  ConnectedSocket,
  MessageBody,
  WsException,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { Logger, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * RealtimeGateway
 *
 * WebSocket gateway for real-time push of:
 *   - appointment status updates
 *   - order status updates
 *   - chat messages (scoped to threads the connected user participates in)
 *
 * AUTH:
 *   Identical JWT strategy to the REST API (Module 1 JwtAuthGuard).
 *   The client sends the JWT as a handshake query param or Authorization header.
 *   On connection, we verify the token and attach user info to socket.data.
 *   If the token is missing or invalid, the socket is immediately disconnected.
 *   There is NO weaker auth path for sockets.
 *
 * CHAT SCOPING:
 *   A client may subscribe to a chat thread via 'subscribe:thread'.
 *   Before joining the room, we verify server-side that the connected user is
 *   a participant in that thread (buyer_profile.user_id or farmer_profile.user_id
 *   on the linked order/appointment). We do NOT trust the client-supplied thread_id.
 *   Clients that fail the scope check receive a WsException and are NOT added to the room.
 *
 * ROOMS:
 *   - 'user:<userId>'         — per-user room for order/appointment status updates
 *   - 'thread:<threadId>'     — scoped room for chat messages
 *
 * EMIT METHODS (called by other services via RealtimeService):
 *   - emitOrderUpdate(orderId, payload)
 *   - emitAppointmentUpdate(appointmentId, payload)
 *   - emitChatMessage(threadId, payload)
 *
 * MISSED MESSAGES:
 *   Sockets are not reliable delivery — use GET /realtime/missed-updates?since=<ISO>
 *   on reconnect to fetch updates that arrived while disconnected.
 */
@Injectable()
@WebSocketGateway({
  cors: {
    origin: process.env.FRONTEND_URL ?? '*', // Lock down in production
    credentials: true,
  },
  namespace: '/realtime',
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config:     ConfigService,
    private readonly prisma:     PrismaService,
  ) {}

  // ─── CONNECTION LIFECYCLE ────────────────────────────────────────────────────

  async handleConnection(client: Socket): Promise<void> {
    try {
      const userId = await this.authenticateSocket(client);
      client.data.userId = userId;

      // Join personal room for order/appointment updates
      await client.join(`user:${userId}`);

      this.logger.log(`Socket connected: id=${client.id} userId=${userId}`);
    } catch (err) {
      this.logger.warn(
        `Socket connection rejected (auth failed): id=${client.id} — ${(err as Error).message}`,
      );
      client.emit('auth_error', { message: 'Authentication failed. Provide a valid JWT.' });
      client.disconnect(true);
    }
  }

  handleDisconnect(client: Socket): void {
    this.logger.log(
      `Socket disconnected: id=${client.id} userId=${client.data?.userId ?? 'unknown'}`,
    );
  }

  // ─── SUBSCRIBE: CHAT THREAD ───────────────────────────────────────────────────

  /**
   * subscribe:thread
   *
   * Client sends: { threadId: string }
   * Server verifies the connected user is a participant in that thread.
   *
   * Participant check: the thread's linked order or appointment must have
   * farmer_profile.user_id = userId  OR  buyer_profile.user_id = userId.
   * Checked server-side — the client-supplied threadId is never trusted blindly.
   *
   * On success: client joins room 'thread:<threadId>' and receives ack { ok: true }.
   * On failure: WsException thrown; client does NOT join the room.
   */
  @SubscribeMessage('subscribe:thread')
  async handleSubscribeThread(
    @ConnectedSocket() client: Socket,
    @MessageBody() data: { threadId: string },
  ): Promise<{ ok: boolean; error?: string }> {
    const userId = client.data?.userId;
    if (!userId) return { ok: false, error: 'Not authenticated.' };

    const { threadId } = data;
    if (!threadId) return { ok: false, error: 'threadId is required.' };

    // Load thread with its linked order / appointment participants
    const thread = await this.prisma.chatThread.findUnique({
      where:  { id: threadId },
      select: {
        id:      true,
        orderId: true,
        appointmentId: true,
        order: {
          select: {
            farmerProfile: { select: { userId: true } },
            buyerProfile:  { select: { userId: true } },
          },
        },
        appointment: {
          select: {
            farmerProfile: { select: { userId: true } },
            buyerProfile:  { select: { userId: true } },
          },
        },
      },
    });

    if (!thread) {
      this.logger.warn(`subscribe:thread — thread ${threadId} not found for userId=${userId}`);
      return { ok: false, error: 'Thread not found.' };
    }

    // Server-side participant check
    const participantIds = new Set<string>();
    if (thread.order) {
      if (thread.order.farmerProfile?.userId) participantIds.add(thread.order.farmerProfile.userId);
      if (thread.order.buyerProfile?.userId)  participantIds.add(thread.order.buyerProfile.userId);
    }
    if (thread.appointment) {
      if (thread.appointment.farmerProfile?.userId) participantIds.add(thread.appointment.farmerProfile.userId);
      if (thread.appointment.buyerProfile?.userId)  participantIds.add(thread.appointment.buyerProfile.userId);
    }

    if (!participantIds.has(userId)) {
      this.logger.warn(
        `subscribe:thread — userId=${userId} is NOT a participant in thread ${threadId}. Access denied.`,
      );
      throw new WsException('Forbidden: you are not a participant in this thread.');
    }

    await client.join(`thread:${threadId}`);
    this.logger.log(`userId=${userId} subscribed to thread:${threadId}`);
    return { ok: true };
  }

  // ─── EMIT HELPERS (called by other services) ────────────────────────────────────────

  /** Push an order status update to all sockets in the user's personal room. */
  emitOrderUpdate(userId: string, payload: Record<string, unknown>): void {
    this.server.to(`user:${userId}`).emit('order:update', payload);
  }

  /** Push an appointment status update to all sockets in the user's personal room. */
  emitAppointmentUpdate(userId: string, payload: Record<string, unknown>): void {
    this.server.to(`user:${userId}`).emit('appointment:update', payload);
  }

  /** Push a chat message to all sockets subscribed to this thread room. */
  emitChatMessage(threadId: string, payload: Record<string, unknown>): void {
    this.server.to(`thread:${threadId}`).emit('chat:message', payload);
  }

  // ─── JWT AUTH HELPER ──────────────────────────────────────────────────────────

  /**
   * authenticateSocket
   *
   * Extracts the JWT from:
   *   1. socket.handshake.auth.token        (preferred — sent via socket.io auth option)
   *   2. socket.handshake.headers.authorization (Bearer <token>)
   *   3. socket.handshake.query.token        (fallback — less secure, avoid in production)
   *
   * Verifies with the same secret as the REST JWT strategy.
   * Returns the userId (sub claim) on success; throws on failure.
   */
  private async authenticateSocket(client: Socket): Promise<string> {
    const token =
      client.handshake.auth?.token ||
      (client.handshake.headers.authorization ?? '').replace(/^Bearer /i, '') ||
      (client.handshake.query.token as string);

    if (!token) {
      throw new WsException('No authentication token provided.');
    }

    const secret = this.config.get<string>('JWT_SECRET');
    if (!secret) {
      throw new WsException('Server misconfiguration: JWT_SECRET not set.');
    }

    let payload: any;
    try {
      payload = await this.jwtService.verifyAsync(token, { secret });
    } catch {
      throw new WsException('Invalid or expired JWT.');
    }

    const userId = payload?.sub;
    if (!userId) throw new WsException('JWT is missing sub claim.');

    return userId;
  }
}
