import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

import { REGISTRATION_PATTERN } from '../tracking-catalogue';

/**
 * The `:vehicleNumber` route parameter.
 *
 * Validated as a plate *shape* rather than as a plate that exists. Two reasons:
 * the generator can produce a coherent record for any well-formed registration,
 * so there is no "not found" case to model yet; and an endpoint that answered
 * differently for registered and unregistered plates would be an enumeration
 * oracle for anyone probing it.
 *
 * The pattern tolerates whatever separators were typed — `JK-05-AB-1234`,
 * `JK05AB1234` and `JK 05 AB 1234` all pass — because the plate is written
 * several different ways in practice and rejecting two of them would be a bug
 * that looks like a validation rule.
 */
export class VehicleNumberParamDto {
  @ApiProperty({
    example: 'JK-05-AB-1234',
    description: 'Indian vehicle registration number. Separators are optional.',
  })
  @IsString()
  @Matches(REGISTRATION_PATTERN, {
    message:
      'vehicleNumber must look like an Indian registration number, e.g. JK-05-AB-1234',
  })
  vehicleNumber: string;
}
