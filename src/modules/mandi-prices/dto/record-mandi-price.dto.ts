import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  IsUUID,
  MaxLength,
  Min,
} from 'class-validator';
import { TrendIndicator } from '@prisma/client';

/**
 * Admin/aggregator payload to record one official market-board rate for the day.
 *
 * `pricePerUnit` is the headline modal rate shown on the listic card; it maps to
 * the model's `modalPrice`. `minPrice`/`maxPrice` are optional and default to the
 * modal rate when a board reports only a single figure. `trendIndicator` is an
 * optional manual override — when omitted the service derives it by comparing
 * against the prior benchmark for the same mandi + commodity.
 */
export class RecordMandiPriceDto {
  @ApiProperty({ example: 'Sopore Fruit Mandi' })
  @IsString()
  @MaxLength(120)
  mandiName!: string;

  @ApiProperty({ example: 'Apple - Delicious' })
  @IsString()
  @MaxLength(120)
  commodity!: string;

  @ApiPropertyOptional({ example: 'Delicious' })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  variety?: string;

  @ApiProperty({ example: 1450, description: 'Headline modal rate per unit of sale.' })
  @IsNumber()
  @IsPositive()
  pricePerUnit!: number;

  @ApiPropertyOptional({ example: 1100 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  minPrice?: number;

  @ApiPropertyOptional({ example: 1800 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  maxPrice?: number;

  @ApiProperty({ example: 'box' })
  @IsString()
  @MaxLength(40)
  unitOfSale!: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  categoryId?: string;

  @ApiPropertyOptional({ example: 'INR', default: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  currency?: string;

  @ApiPropertyOptional({ enum: TrendIndicator, description: 'Optional manual override.' })
  @IsOptional()
  @IsEnum(TrendIndicator)
  trendIndicator?: TrendIndicator;
}
