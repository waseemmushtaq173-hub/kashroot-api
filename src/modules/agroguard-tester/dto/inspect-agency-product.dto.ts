import {
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Dealer info + scan signals for a single agency-bottle inspection. The bottle
 * image itself arrives as the `bottleImage` multipart file (see controller); a
 * pre-uploaded `scannedBottleImageUrl` may be supplied instead. Boolean/array
 * fields are auto-coerced by the global ValidationPipe (implicit conversion).
 */
export class InspectAgencyProductDto {
  @IsString()
  @MaxLength(160)
  agencyName!: string;

  @IsString()
  @MaxLength(120)
  productBrand!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  scannedBatchNo?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  scannedBottleImageUrl?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  observedHologramPattern?: string;

  @IsOptional()
  @IsBoolean()
  logoMatchesFactory?: boolean;

  @IsOptional()
  @IsBoolean()
  sealPresent?: boolean;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  fontAnomalies?: string[];
}
