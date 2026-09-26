import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString, MaxLength } from 'class-validator';
import { AdvisoryCategory } from '@prisma/client';

/** Optional filters for the public farming-advisory knowledge feed. */
export class QueryAdvisoryDto {
  @ApiPropertyOptional({ enum: AdvisoryCategory })
  @IsOptional()
  @IsEnum(AdvisoryCategory)
  category?: AdvisoryCategory;

  @ApiPropertyOptional({ example: 'Apple', description: 'Filter by an applicable crop.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  crop?: string;

  @ApiPropertyOptional({ example: 'Sopore', description: 'Filter by an applicable region.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  region?: string;
}
