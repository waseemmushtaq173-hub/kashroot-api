import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TrendIndicator } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { QueryMandiPricesDto } from './dto/query-mandi-prices.dto';

/** One row as reported by an official APMC daily bulletin. */
interface ApmcBulletinRecord {
  mandiName: string;
  commodity: string;
  variety?: string;
  minPrice: number;
  maxPrice: number;
  modalPrice: number;
  unitOfSale: string;
  recordedAt: Date;
}

@Injectable()
export class MandiPricesService {
  private readonly logger = new Logger(MandiPricesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Public read model: official regulated physical mandi rates, newest first,
   * optionally filtered by region or by the physical mandi's name.
   */
  async findAll(filter: QueryMandiPricesDto) {
    return this.prisma.mandiPrice.findMany({
      where: {
        ...(filter.regionId ? { regionId: filter.regionId } : {}),
        ...(filter.mandiName
          ? { mandiName: { equals: filter.mandiName, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: 200,
    });
  }

  /**
   * Ingest the official Agmarknet / APMC daily bulletin. Real deployments would
   * pull from the Agmarknet API or the Directorate of Horticulture J&K feed;
   * here we mock a representative bulletin so the pipeline is exercised end-to-end.
   */
  async syncOfficialApmcData(): Promise<{ synced: number }> {
    const bulletin = this.mockOfficialBulletin();
    let synced = 0;

    for (const record of bulletin) {
      // Trend is derived from the prior APMC benchmark, not any marketplace rate.
      const trendIndicator = await this.computeTrend(
        record.mandiName,
        record.commodity,
        record.modalPrice,
        record.recordedAt,
      );

      await this.prisma.mandiPrice.create({
        data: {
          mandiName: record.mandiName,
          commodity: record.commodity,
          variety: record.variety ?? null,
          minPrice: record.minPrice,
          maxPrice: record.maxPrice,
          modalPrice: record.modalPrice,
          unitOfSale: record.unitOfSale,
          currency: 'INR',
          trendIndicator,
          audioPrompts: this.buildAudioPrompts(record) as Prisma.InputJsonValue,
          recordedAt: record.recordedAt,
        },
      });
      synced += 1;
    }

    this.logger.log(`Synced ${synced} official APMC benchmark record(s).`);
    return { synced };
  }

  /**
   * Compare the latest modal price against the prior day's benchmark for the same
   * physical mandi + commodity and classify the movement.
   */
  async computeTrend(
    mandiName: string,
    commodity: string,
    currentModalPrice: number,
    asOf: Date,
  ): Promise<TrendIndicator> {
    const prior = await this.prisma.mandiPrice.findFirst({
      where: { mandiName, commodity, recordedAt: { lt: asOf } },
      orderBy: { recordedAt: 'desc' },
      select: { modalPrice: true },
    });

    if (!prior) return TrendIndicator.STABLE; // no history yet

    const priorModal = Number(prior.modalPrice);
    if (currentModalPrice > priorModal) return TrendIndicator.UP;
    if (currentModalPrice < priorModal) return TrendIndicator.DOWN;
    return TrendIndicator.STABLE;
  }

  /**
   * Prepare per-language audio prompt URLs for the voice-first client. The actual
   * TTS synthesis/upload is handled by the audio pipeline; this wires the map shape.
   */
  private buildAudioPrompts(record: ApmcBulletinRecord): Record<string, string> {
    const slug = `${record.mandiName}-${record.commodity}-${record.recordedAt
      .toISOString()
      .slice(0, 10)}`
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/(^-|-$)/g, '');
    const base = 'https://cdn.mock.local/mandi-audio';
    return {
      KASHMIRI: `${base}/ks/${slug}.mp3`,
      URDU: `${base}/ur/${slug}.mp3`,
      HINDI: `${base}/hi/${slug}.mp3`,
    };
  }

  /** Stand-in for the official bulletin ingest (Sopore / Parimpora / Narwal). */
  private mockOfficialBulletin(): ApmcBulletinRecord[] {
    const today = new Date();
    return [
      { mandiName: 'Sopore Fruit Mandi', commodity: 'Apple - Delicious', variety: 'Delicious', minPrice: 1100, maxPrice: 1800, modalPrice: 1450, unitOfSale: 'box', recordedAt: today },
      { mandiName: 'Parimpora Fruit Mandi', commodity: 'Apple - Kullu', variety: 'Kullu', minPrice: 900, maxPrice: 1600, modalPrice: 1250, unitOfSale: 'box', recordedAt: today },
      { mandiName: 'Narwal Mandi', commodity: 'Walnut', minPrice: 400, maxPrice: 750, modalPrice: 600, unitOfSale: 'kg', recordedAt: today },
    ];
  }
}
