import { Transform, TransformFnParams, Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsDateString,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Body accepted by POST /listings.
 *
 * FIELD NAMES ARE THE CLIENT'S, NOT THE DATABASE'S.
 * The farmer form (kashroot-web .../farmer/listings/new/page.tsx, buildDto)
 * sends `commodity`, `unit`, `stockQuantity`, `harvestDate` and
 * `minimumOrderQuantity`, none of which are Listing column names. Accepting the
 * client's names here and translating in ListingsService keeps the web app from
 * having to change, and keeps the wire format in one place.
 *
 * Because the global ValidationPipe sets `forbidNonWhitelisted: true`, every
 * field the form sends must be declared here or the request is rejected with a
 * 400 before it ever reaches the service.
 */

/**
 * JSON bodies carry real booleans, so this mostly passes through unchanged. It
 * still reads the raw source object rather than `value` for the same reason as
 * the query DTO: main.ts sets `transformOptions.enableImplicitConversion`, and
 * that coercion to Boolean runs before the custom transform, so a transform
 * reading `value` cannot distinguish 'false' from 'true' if a string arrives.
 */
const toBoolean = ({ obj, key }: TransformFnParams): boolean => {
  const raw = (obj as Record<string, unknown>)[key];
  return raw === true || raw === 'true';
};

export class CreateListingDto {
  @ApiProperty({ maxLength: 200 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  title!: string;

  /** Resolved against Category.name. An unknown value is a 400, not a new category. */
  @ApiProperty({ description: 'Category name, e.g. "Apples"', example: 'Apples' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  commodity!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  description?: string;

  @ApiProperty({ description: 'Price per unit of sale' })
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @IsPositive()
  pricePerUnit!: number;

  @ApiPropertyOptional({ default: 'INR', description: 'ISO-4217 currency code' })
  @IsOptional()
  @IsString()
  @Length(3, 3)
  currency?: string;

  /** Maps to Listing.unitOfSale. */
  @ApiProperty({ description: "Unit of sale, e.g. 'kg', 'box', 'dozen'" })
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  unit!: string;

  /** Maps to Listing.stock — the column orders.service.ts validates and decrements. */
  @ApiProperty({ description: 'Units available for sale' })
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  stockQuantity!: number;

  @ApiPropertyOptional({ description: 'Region id or name; unresolved values are stored as null' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  originRegion?: string;

  /** Maps to Listing.harvestStart. The form supplies a single date. */
  @ApiPropertyOptional({ example: '2026-09-15' })
  @IsOptional()
  @IsDateString()
  harvestDate?: string;

  /** Maps to Listing.minOrderQty. */
  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 4 })
  @Min(0)
  minimumOrderQuantity?: number;

  /**
   * Certification names. Each is find-or-created against this farmer's
   * Certification rows and linked via ListingCertification.
   */
  @ApiPropertyOptional({ type: [String], example: ['GI Tag'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @MaxLength(100, { each: true })
  certifications?: string[];

  /**
   * Represented as an 'Organic' certification, matching the schema's own
   * example for Certification.name, so this round-trips through the read path.
   */
  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isOrganic?: boolean;
}
