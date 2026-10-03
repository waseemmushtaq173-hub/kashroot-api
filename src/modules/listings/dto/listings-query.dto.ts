import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query params accepted by GET /listings.
 *
 * This mirrors ListingSearchParams in kashroot-web/src/lib/api/buyer.ts exactly.
 * The global ValidationPipe runs with `forbidNonWhitelisted: true`, so any param
 * the client sends that is not declared here is rejected with a 400 — the two
 * definitions have to stay in step.
 */

/**
 * Query strings arrive as text, and class-transformer's implicit conversion
 * would turn the string "false" into Boolean("false") === true. That is the
 * wrong answer for every value except the empty string, so parse it explicitly.
 */
const toBoolean = ({ value }: { value: unknown }): boolean =>
  value === true || value === 'true';

export class ListingsQueryDto {
  @ApiPropertyOptional({ description: 'Free-text search against the listing title' })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({ description: 'Category name, e.g. "Apples"' })
  @IsOptional()
  @IsString()
  commodity?: string;

  @ApiPropertyOptional({ description: 'Region id (e.g. region-punjab) or region name' })
  @IsOptional()
  @IsString()
  originRegion?: string;

  @ApiPropertyOptional({ description: 'Minimum price per unit' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ description: 'Maximum price per unit' })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiPropertyOptional({ description: 'ISO-4217 currency code' })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({ description: 'Only listings carrying an "Organic" certification' })
  @IsOptional()
  @Transform(toBoolean)
  @IsBoolean()
  isOrganic?: boolean;

  @ApiPropertyOptional({ description: 'Comma-separated certification names' })
  @IsOptional()
  @IsString()
  certifications?: string;

  @ApiPropertyOptional({
    description:
      'Accepted for client-contract compatibility. No trust rule exists yet, so this is not applied.',
  })
  @IsOptional()
  @IsString()
  trustGate?: string;

  @ApiPropertyOptional({ default: 1, description: '1-based page number' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 12, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 12;
}
