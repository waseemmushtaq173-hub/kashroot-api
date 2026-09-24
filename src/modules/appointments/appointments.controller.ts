import {
  Controller,
  Get,
  Post,
  Patch,
  Param,
  Body,
  UseGuards,
  ParseUUIDPipe,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';
import { AppointmentsService } from './appointments.service';
import { CreateAppointmentDto } from './dto/create-appointment.dto';
import { RespondAppointmentDto, MarkNoShowDto, CompleteAppointmentDto } from './dto/respond-appointment.dto';
import { RescheduleAppointmentDto } from './dto/reschedule-appointment.dto';

@ApiTags('Appointments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private readonly appointmentsService: AppointmentsService) {}

  // ─────────────────────────────────────────────────────────────────────────
  // READ
  // ─────────────────────────────────────────────────────────────────────────

  @Get('me')
  @Roles('BUYER', 'FARMER', 'ADMIN', 'REGIONAL_ADMIN', 'SUPPORT_MODERATOR', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'List all appointments the caller is a party to' })
  findMyAppointments(@CurrentUser() user: AuthenticatedUser) {
    return this.appointmentsService.findMyAppointments(user);
  }

  @Get(':id')
  @Roles('BUYER', 'FARMER', 'ADMIN', 'REGIONAL_ADMIN', 'SUPPORT_MODERATOR', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Get a single appointment (caller must be a participant)' })
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.findOne(id, user);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CREATE  — buyer requests an appointment
  // ─────────────────────────────────────────────────────────────────────────

  @Post()
  @Roles('BUYER')
  @ApiOperation({ summary: 'Buyer requests an appointment with a farmer' })
  create(
    @Body() dto: CreateAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.create(dto, user);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESPOND  — farmer confirms or declines
  // ─────────────────────────────────────────────────────────────────────────

  @Patch(':id/respond')
  @Roles('FARMER')
  @ApiOperation({ summary: 'Farmer confirms or declines an appointment request' })
  respond(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RespondAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.respond(id, dto, user);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // COMPLETE  — farmer marks meeting done
  // CRITICAL: Only COMPLETED satisfies the trust-gate. CONFIRMED is NOT enough.
  // ─────────────────────────────────────────────────────────────────────────

  @Patch(':id/complete')
  @Roles('FARMER')
  @ApiOperation({ summary: 'Farmer marks appointment as COMPLETED (trust-gate unlock)' })
  complete(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CompleteAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.complete(id, dto, user);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NO-SHOW
  // ─────────────────────────────────────────────────────────────────────────

  @Patch(':id/no-show')
  @Roles('BUYER', 'FARMER')
  @ApiOperation({
    summary: 'Flag the other party as a no-show (caller must be a participant)',
    description:
      'FARMER calls → BUYER is flagged. BUYER calls → FARMER is flagged. ' +
      'Increments no_show_count on the flagged profile. If threshold is breached, ' +
      'writes an audit_log review flag (does NOT auto-suspend).',
  })
  markNoShow(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MarkNoShowDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.markNoShow(id, dto, user);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // RESCHEDULE
  // ─────────────────────────────────────────────────────────────────────────

  @Post(':id/reschedule')
  @Roles('BUYER', 'FARMER')
  @ApiOperation({
    summary: 'Reschedule an appointment (old → RESCHEDULED; new row → REQUESTED)',
    description:
      'Old appointment is preserved as RESCHEDULED (for audit). ' +
      'A new REQUESTED appointment is created. ' +
      'The old BullMQ reminder job is cancelled; new reminder scheduled on farmer re-confirm.',
  })
  reschedule(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RescheduleAppointmentDto,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.reschedule(id, dto, user);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // CANCEL
  // ─────────────────────────────────────────────────────────────────────────

  @Patch(':id/cancel')
  @Roles('BUYER', 'FARMER', 'REGIONAL_ADMIN', 'SUPER_ADMIN')
  @ApiOperation({ summary: 'Cancel an appointment (either party or admin)' })
  @HttpCode(HttpStatus.OK)
  cancel(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser() user: AuthenticatedUser,
  ) {
    return this.appointmentsService.cancel(id, user);
  }
}
