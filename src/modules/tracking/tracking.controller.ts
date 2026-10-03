import { Controller, Get, Param } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';

import { TrackingService } from './tracking.service';
import { VehicleNumberParamDto } from './dto/vehicle-number-param.dto';
import type { LiveVehicleTracking } from './tracking.types';

/**
 * Live vehicle tracking.
 *
 * AUTHENTICATED, DIFFERENTLY FROM THE MANDI FEED
 *
 * `MandiLiveController` is `@Public()` because a market price is a public good
 * and the data behind it is published by a government body. This is not. Even
 * with every field generated, the *shape* of this response is personal data:
 * a named driver, a contact number, and a real-time position for a named
 * vehicle. Serving that unauthenticated would set the precedent that the
 * tracking surface is open, and the day it is wired to a real telematics feed
 * that precedent would already be a disclosure — every plate in the country
 * probeable by anyone who can guess a registration.
 *
 * No `@RequirePermissions` decorator: any signed-in user may look up a vehicle.
 * `PermissionsGuard` passes through when no permission is declared, so the
 * effect is "authenticated, no specific role needed" — which is the intent,
 * since a grower, a driver and a buyer all have a legitimate reason to see
 * where a consignment is.
 */
@ApiTags('Tracking')
@Controller('tracking')
export class TrackingController {
  constructor(private readonly tracking: TrackingService) {}

  /**
   * GET /api/v1/tracking/JK-05-AB-1234   (global prefix adds /api/v1)
   * The current position and consignment detail for one vehicle.
   */
  @Get(':vehicleNumber')
  @ApiParam({
    name: 'vehicleNumber',
    example: 'JK-05-AB-1234',
    description: 'Indian vehicle registration number. Separators are optional.',
  })
  @ApiOperation({ summary: 'Live position and consignment detail for a vehicle' })
  track(@Param() params: VehicleNumberParamDto): LiveVehicleTracking {
    return this.tracking.track(params.vehicleNumber);
  }
}
