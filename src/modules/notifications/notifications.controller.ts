import {
  Controller,
  Get,
  Put,
  Body,
  Query,
  Req,
  UseGuards,
  ParseIntPipe,
  DefaultValuePipe,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiBearerAuth, ApiQuery } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { NotificationsService } from './notifications.service';
import { UpdateNotificationPreferenceDto } from './dto/notification.dto';
import { RequestWithUser } from '../../common/types/request-with-user.type';

/**
 * NotificationsController
 *
 * Endpoints for the authenticated user to:
 *   - GET  /notifications/preferences         — list all their preferences
 *   - PUT  /notifications/preferences         — update one category+channel preference
 *   - GET  /notifications/history             — view SENT/FAILED notification history
 *
 * No admin-only endpoints here; admin operations (re-trigger, inspect failures)
 * belong in the AdminController and should use ServiceAccountGuard or PLATFORM_ADMIN role.
 */
@ApiTags('Notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  // ─── PREFERENCES ───────────────────────────────────────────────────────────

  @Get('preferences')
  @ApiOperation({ summary: 'Get all notification preferences for the current user' })
  async getPreferences(@Req() req: RequestWithUser) {
    return this.notifications.getPreferences(req.user.sub);
  }

  @Put('preferences')
  @ApiOperation({
    summary: 'Update a notification preference (enable/disable a category+channel)',
    description:
      'Upserts a single preference row. To re-enable a channel that was disabled, ' +
      'set enabled=true. Absent preference rows default to enabled (opt-out model).'
  })
  async updatePreference(
    @Req() req: RequestWithUser,
    @Body() dto: UpdateNotificationPreferenceDto,
  ) {
    return this.notifications.setPreference(
      req.user.sub,
      dto.category,
      dto.channel,
      dto.enabled,
    );
  }

  // ─── HISTORY ───────────────────────────────────────────────────────────────

  @Get('history')
  @ApiOperation({
    summary: 'Get notification send history for the current user',
    description:
      'Returns SENT and FAILED rows from notification_queue in reverse chronological order. ' +
      'Use `since` (ISO-8601) to paginate by time window. ' +
      'FAILED rows include the last_error message to surface provider failures.'
  })
  @ApiQuery({ name: 'since',  required: false, description: 'ISO-8601 timestamp lower bound.' })
  @ApiQuery({ name: 'limit',  required: false, description: 'Max rows returned. Default 50, max 200.' })
  async getHistory(
    @Req() req: RequestWithUser,
    @Query('since')  since?: string,
    @Query('limit',  new DefaultValuePipe(50), ParseIntPipe) limit?: number,
  ) {
    return this.notifications.getHistory(req.user.sub, since, limit);
  }
}
