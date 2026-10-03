import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Decimal degrees, shaped the way a query string carries them. */
const DECIMAL_DEGREES = /^-?\d+(\.\d+)?$/;

/** Blank form fields arrive as empty strings; treat those as "not supplied". */
const blankToUndefined = ({ value }: { value: unknown }) =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

/**
 * Query for the location-resolved mandi feed.
 *
 * A caller identifies its location in one of two ways: by naming a hub from
 * `GET /api/v1/mandi/locations`, or by handing over a browser fix. Naming a hub
 * is what the selector does; the coordinates path is what "Use my location"
 * does, and the server resolves those to the nearest hub so nothing about the
 * hub list has to be duplicated in the client.
 *
 * Coordinates are typed `string` on purpose. The global pipe runs with
 * `enableImplicitConversion`, which coerces a property declared `number`
 * *before* any decorator can inspect it — so `?lat=` would arrive as 0, and
 * "the browser declined to share a location" would become indistinguishable
 * from "zero degrees latitude". Keeping the raw text preserves that difference.
 * This class validates the shape; `MandiLiveService` parses the value and owns
 * the range check.
 */
export class QueryLiveMandiDto {
  @ApiPropertyOptional({
    example: 'punjab',
    description:
      'Hub id from GET /api/v1/mandi/locations. Optional, but either this or both coordinates are required.',
  })
  @IsOptional()
  @IsString()
  location?: string;

  @ApiPropertyOptional({
    example: '30.901',
    description:
      'Latitude in decimal degrees, as a string. Supply together with `lng`.',
  })
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_DEGREES, { message: 'lat must be a decimal number' })
  lat?: string;

  @ApiPropertyOptional({
    example: '75.857',
    description:
      'Longitude in decimal degrees, as a string. Supply together with `lat`.',
  })
  @Transform(blankToUndefined)
  @IsOptional()
  @IsString()
  @Matches(DECIMAL_DEGREES, { message: 'lng must be a decimal number' })
  lng?: string;

  @ApiPropertyOptional({
    example: 'Apple',
    description: 'Commodity name. Defaults to Apple.',
  })
  @IsOptional()
  @IsString()
  commodity?: string;
}
