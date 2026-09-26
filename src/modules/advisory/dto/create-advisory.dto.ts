import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayNotEmpty,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import { AdvisoryCategory } from '@prisma/client';

/**
 * Payload to author one verified farming advisory. The visual `topic`/`content`
 * stays English (see the spoken-audio spec); per-language TTS clips are rendered
 * by the service, not supplied here.
 */
export class CreateAdvisoryDto {
  @ApiProperty({ example: 'Apple Scab Spray Schedule (Pink Bud Stage)' })
  @IsString()
  @MaxLength(160)
  topic!: string;

  @ApiProperty({ enum: AdvisoryCategory, example: AdvisoryCategory.SPRAY_SCHEDULE })
  @IsEnum(AdvisoryCategory)
  category!: AdvisoryCategory;

  @ApiProperty({
    example:
      'At the pink bud stage, spray Mancozeb 75% WP at 3 g per litre of water to ' +
      'protect against apple scab. Repeat after rain or every 10-12 days.',
  })
  @IsString()
  @MaxLength(2000)
  content!: string;

  @ApiProperty({ type: [String], example: ['Apple'] })
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  applicableCrops!: string[];

  @ApiPropertyOptional({ type: [String], example: ['Sopore', 'Shopian'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  applicableRegions?: string[];

  @ApiProperty({ example: 'SKUAST-K / J&K Horticulture Department' })
  @IsString()
  @MaxLength(160)
  source!: string;
}
