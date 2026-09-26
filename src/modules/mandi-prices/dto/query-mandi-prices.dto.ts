import { IsOptional, IsString, IsUUID } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/** Optional filters for the public APMC mandi benchmark feed. */
export class QueryMandiPricesDto {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  regionId?: string;

  @ApiPropertyOptional({ example: 'Sopore Fruit Mandi' })
  @IsOptional()
  @IsString()
  mandiName?: string;
}
