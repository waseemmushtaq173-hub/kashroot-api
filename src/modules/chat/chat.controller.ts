import {
  Controller, Post, Get, Delete, Param, Body, UseGuards, Request, Query,
} from '@nestjs/common';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { UserRole } from '../auth/enums/user-role.enum';
import { ChatService } from './chat.service';

/**
 * ChatController — /chat
 *
 * Threads are scoped to a single order or appointment (never open DMs).
 * Access checks:
 *   - Regular users: assertUserIsParticipant() enforced before read/write.
 *   - SUPPORT_MODERATOR+: bypass participant check; can see soft-deleted messages.
 */
@ApiTags('chat')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('chat')
export class ChatController {
  constructor(private readonly chatService: ChatService) {}

  // ─── Threads ────────────────────────────────────────────────────────────

  @Post('threads/order/:orderId')
  @ApiOperation({ summary: 'Get or create chat thread for an order' })
  async getOrCreateForOrder(
    @Param('orderId') orderId: string,
    @Body('subject') subject: string,
    @Request() req: any,
  ) {
    const isModerator = this.isModerator(req.user.role);
    const thread = await this.chatService.getOrCreateThreadForOrder(orderId, subject);
    if (!isModerator) await this.chatService.assertUserIsParticipant(thread.id, req.user.id);
    return thread;
  }

  @Post('threads/appointment/:appointmentId')
  @ApiOperation({ summary: 'Get or create chat thread for an appointment' })
  async getOrCreateForAppointment(
    @Param('appointmentId') appointmentId: string,
    @Body('subject') subject: string,
    @Request() req: any,
  ) {
    const isModerator = this.isModerator(req.user.role);
    const thread = await this.chatService.getOrCreateThreadForAppointment(appointmentId, subject);
    if (!isModerator) await this.chatService.assertUserIsParticipant(thread.id, req.user.id);
    return thread;
  }

  @Post('threads/:threadId/archive')
  @Roles(UserRole.SUPPORT_MODERATOR, UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN)
  @ApiOperation({ summary: 'Archive a thread (no more messages)' })
  async archiveThread(@Param('threadId') threadId: string) {
    return this.chatService.archiveThread(threadId);
  }

  // ─── Messages ───────────────────────────────────────────────────────────

  @Post('threads/:threadId/messages')
  @ApiOperation({ summary: 'Send a message to a thread' })
  async sendMessage(
    @Param('threadId') threadId: string,
    @Body('body') body: string,
    @Request() req: any,
  ) {
    const isModerator = this.isModerator(req.user.role);
    if (!isModerator) await this.chatService.assertUserIsParticipant(threadId, req.user.id);
    return this.chatService.sendMessage(threadId, req.user.id, body);
  }

  @Get('threads/:threadId/messages')
  @ApiOperation({ summary: 'List messages in a thread' })
  async listMessages(
    @Param('threadId') threadId: string,
    @Query('includeDeleted') includeDeleted: string,
    @Request() req: any,
  ) {
    const isModerator    = this.isModerator(req.user.role);
    const showDeleted    = isModerator && includeDeleted === 'true';
    if (!isModerator) await this.chatService.assertUserIsParticipant(threadId, req.user.id);
    return this.chatService.listMessages(threadId, showDeleted);
  }

  @Delete('messages/:messageId')
  @ApiOperation({ summary: 'Soft-delete a message (body preserved for audit)' })
  async deleteMessage(
    @Param('messageId') messageId: string,
    @Request() req: any,
  ) {
    const isModerator = this.isModerator(req.user.role);
    return this.chatService.softDeleteMessage(messageId, req.user.id, isModerator);
  }

  // ─── Helpers ───────────────────────────────────────────────────────────

  private isModerator(role: string): boolean {
    return [UserRole.SUPPORT_MODERATOR, UserRole.REGIONAL_ADMIN, UserRole.PLATFORM_ADMIN].includes(role as UserRole);
  }
}
