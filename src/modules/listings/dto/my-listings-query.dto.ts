import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query params accepted by GET /listings/mine.
 *
 * Mirrors ListingsQuery in kashroot-web/src/lib/api/farmer.ts ({ page?, limit?,
 * status? }). It is a separate DTO from ListingsQueryDto rather than a reuse of
 * it: the buyer's search filters (q, price range, certifications, trustGate)
 * have no meaning on a farmer's own listings, and with `forbidNonWhitelisted`
 * turned on, inheriting them would advertise params that silently do nothing.
 *
 * `status` is the client's three-state vocabulary, not the Prisma enum — the
 * service translates it via toDbStatuses().
 */

const CLIENT_STATUSES = ['DRAFT', 'PUBLISHED', 'SUSPENDED'] as const;

export class MyListingsQueryDto {
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

  @ApiPropertyOptional({
    enum: CLIENT_STATUSES,
    description:
      'Client-facing status. PUBLISHED covers both ACTIVE and SOLD_OUT; ' +
      'archived listings are never returned.',
  })
  @IsOptional()
  @IsIn(CLIENT_STATUSES)
  status?: (typeof CLIENT_STATUSES)[number];
}
