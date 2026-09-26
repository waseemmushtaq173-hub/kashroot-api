import { Injectable, Logger } from '@nestjs/common';
import { Prisma, TrendIndicator } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { QueryMandiPricesDto } from './dto/query-mandi-prices.dto';
import { RecordMandiPriceDto } from './dto/record-mandi-price.dto';

/** Visual cue metadata a listic card renders for each trend direction. */
const TREND_VISUALS: Record<TrendIndicator, { arrow: string; color: string }> = {
  [TrendIndicator.UP]: { arrow: '▲', color: 'green' },
  [TrendIndicator.DOWN]: { arrow: '▼', color: 'red' },
  [TrendIndicator.STABLE]: { arrow: '—', color: 'grey' },
};

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
   * Picture-driven "listic" read model for the voice-first client. Returns the
   * single latest rate per (mandi + commodity + variety), each shaped as a card
   * carrying the headline price, a trend arrow/colour, and per-language audio
   * prompts. Optionally filtered by region and/or commodity.
   */
  async findLatestRegionalPrices(filter: QueryMandiPricesDto) {
    const rows = await this.prisma.mandiPrice.findMany({
      where: {
        ...(filter.regionId ? { regionId: filter.regionId } : {}),
        ...(filter.commodity
          ? { commodity: { equals: filter.commodity, mode: 'insensitive' } }
          : {}),
      },
      orderBy: { recordedAt: 'desc' },
      take: 200,
    });

    // Rows are newest-first; keep the first (latest) seen per board+commodity+variety.
    const latest = new Map<string, (typeof rows)[number]>();
    for (const row of rows) {
      const key = `${row.mandiName}|${row.commodity}|${row.variety ?? ''}`;
      if (!latest.has(key)) latest.set(key, row);
    }

    return [...latest.values()].map((row) => this.toListicCard(row));
  }

  /**
   * Record (or correct) one official market-board rate for the current day.
   * Behaves as a same-day upsert: a second submission for the same mandi +
   * commodity + variety on the same calendar day updates that row rather than
   * appending a duplicate, so prior days stay intact for trend computation.
   * When no `trendIndicator` is supplied it is derived from the prior day.
   */
  async recordDailyPrice(input: RecordMandiPriceDto) {
    const recordedAt = new Date();
    const startOfDay = new Date(recordedAt);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(startOfDay);
    endOfDay.setDate(endOfDay.getDate() + 1);

    const modalPrice = input.pricePerUnit;
    const minPrice = input.minPrice ?? modalPrice;
    const maxPrice = input.maxPrice ?? modalPrice;

    // Manual override, else derive from the prior day's benchmark for this board.
    const trendIndicator =
      input.trendIndicator ??
      (await this.computeTrend(input.mandiName, input.commodity, modalPrice, startOfDay));

    const data = {
      regionId: input.regionId ?? null,
      categoryId: input.categoryId ?? null,
      mandiName: input.mandiName,
      commodity: input.commodity,
      variety: input.variety ?? null,
      minPrice,
      maxPrice,
      modalPrice,
      unitOfSale: input.unitOfSale,
      currency: input.currency ?? 'INR',
      trendIndicator,
      audioPrompts: this.buildAudioPrompts({
        mandiName: input.mandiName,
        commodity: input.commodity,
        variety: input.variety,
        minPrice,
        maxPrice,
        modalPrice,
        unitOfSale: input.unitOfSale,
        recordedAt,
      }) as Prisma.InputJsonValue,
      recordedAt,
    };

    const existing = await this.prisma.mandiPrice.findFirst({
      where: {
        mandiName: input.mandiName,
        commodity: input.commodity,
        variety: input.variety ?? null,
        recordedAt: { gte: startOfDay, lt: endOfDay },
      },
      select: { id: true },
    });

    const saved = existing
      ? await this.prisma.mandiPrice.update({ where: { id: existing.id }, data })
      : await this.prisma.mandiPrice.create({ data });

    this.logger.log(
      `Recorded ${input.commodity} @ ${input.mandiName} = ${modalPrice} (${trendIndicator})`,
    );
    return this.toListicCard(saved);
  }

  /** Shape one persisted row into a picture-driven listic card for the UI. */
  private toListicCard(row: {
    id: string;
    mandiName: string;
    commodity: string;
    variety: string | null;
    regionId: string | null;
    minPrice: Prisma.Decimal | number;
    maxPrice: Prisma.Decimal | number;
    modalPrice: Prisma.Decimal | number;
    unitOfSale: string;
    currency: string;
    trendIndicator: TrendIndicator;
    audioPrompts: Prisma.JsonValue | null;
    recordedAt: Date;
  }) {
    const modal = Number(row.modalPrice);
    const visual = TREND_VISUALS[row.trendIndicator];
    return {
      id: row.id,
      mandiName: row.mandiName,
      commodity: row.commodity,
      variety: row.variety,
      regionId: row.regionId,
      price: {
        modal,
        min: Number(row.minPrice),
        max: Number(row.maxPrice),
        unitOfSale: row.unitOfSale,
        currency: row.currency,
        display:
          row.currency === 'INR'
            ? `₹${modal.toLocaleString('en-IN')}/${row.unitOfSale}`
            : `${modal} ${row.currency}/${row.unitOfSale}`,
      },
      trend: {
        indicator: row.trendIndicator,
        arrow: visual.arrow,
        color: visual.color,
      },
      audioPrompts: row.audioPrompts ?? null,
      recordedAt: row.recordedAt,
    };
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
