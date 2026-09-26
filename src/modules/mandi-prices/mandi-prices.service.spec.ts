import { Test, TestingModule } from '@nestjs/testing';
import { TrendIndicator } from '@prisma/client';

import { MandiPricesService } from './mandi-prices.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('MandiPricesService', () => {
  let service: MandiPricesService;

  const mockPrisma = {
    mandiPrice: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
      create: jest.fn().mockResolvedValue({ id: 'mp-1' }),
      update: jest.fn().mockResolvedValue({ id: 'mp-1' }),
    },
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MandiPricesService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<MandiPricesService>(MandiPricesService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('computeTrend', () => {
    const asOf = new Date('2026-09-26T00:00:00.000Z');

    it('returns STABLE when there is no prior benchmark', async () => {
      mockPrisma.mandiPrice.findFirst.mockResolvedValue(null);
      await expect(
        service.computeTrend('Sopore Fruit Mandi', 'Apple - Delicious', 1450, asOf),
      ).resolves.toBe(TrendIndicator.STABLE);
    });

    it('returns UP when the modal price rose vs the prior day', async () => {
      mockPrisma.mandiPrice.findFirst.mockResolvedValue({ modalPrice: 1200 });
      await expect(
        service.computeTrend('Sopore Fruit Mandi', 'Apple - Delicious', 1450, asOf),
      ).resolves.toBe(TrendIndicator.UP);
    });

    it('returns DOWN when the modal price fell vs the prior day', async () => {
      mockPrisma.mandiPrice.findFirst.mockResolvedValue({ modalPrice: 1600 });
      await expect(
        service.computeTrend('Sopore Fruit Mandi', 'Apple - Delicious', 1450, asOf),
      ).resolves.toBe(TrendIndicator.DOWN);
    });

    it('returns STABLE when the modal price is unchanged', async () => {
      mockPrisma.mandiPrice.findFirst.mockResolvedValue({ modalPrice: 1450 });
      await expect(
        service.computeTrend('Sopore Fruit Mandi', 'Apple - Delicious', 1450, asOf),
      ).resolves.toBe(TrendIndicator.STABLE);
    });
  });

  describe('syncOfficialApmcData', () => {
    it('ingests the bulletin and prepares tri-lingual audio prompts', async () => {
      mockPrisma.mandiPrice.findFirst.mockResolvedValue(null); // fresh history

      const { synced } = await service.syncOfficialApmcData();

      expect(synced).toBe(3);
      expect(mockPrisma.mandiPrice.create).toHaveBeenCalledTimes(3);

      const firstArg = mockPrisma.mandiPrice.create.mock.calls[0][0].data;
      expect(firstArg.audioPrompts).toEqual(
        expect.objectContaining({
          KASHMIRI: expect.any(String),
          URDU: expect.any(String),
          HINDI: expect.any(String),
        }),
      );
      // No history yet -> every record classified STABLE.
      expect(firstArg.trendIndicator).toBe(TrendIndicator.STABLE);
    });
  });

  describe('recordDailyPrice', () => {
    const base = {
      mandiName: 'Sopore Fruit Mandi',
      commodity: 'Apple - Delicious',
      pricePerUnit: 1500,
      unitOfSale: 'box',
    };

    it('creates a new row and derives an UP trend from the prior benchmark', async () => {
      // computeTrend lookup (prior day) then same-day existing lookup (none).
      mockPrisma.mandiPrice.findFirst
        .mockResolvedValueOnce({ modalPrice: 1200 }) // prior benchmark
        .mockResolvedValueOnce(null); // no same-day row
      mockPrisma.mandiPrice.create.mockResolvedValue({
        id: 'mp-new',
        mandiName: base.mandiName,
        commodity: base.commodity,
        variety: null,
        regionId: null,
        minPrice: 1500,
        maxPrice: 1500,
        modalPrice: 1500,
        unitOfSale: 'box',
        currency: 'INR',
        trendIndicator: TrendIndicator.UP,
        audioPrompts: { KASHMIRI: 'x', URDU: 'y', HINDI: 'z' },
        recordedAt: new Date(),
      });

      const card = await service.recordDailyPrice(base);

      expect(mockPrisma.mandiPrice.create).toHaveBeenCalledTimes(1);
      expect(mockPrisma.mandiPrice.update).not.toHaveBeenCalled();
      const data = mockPrisma.mandiPrice.create.mock.calls[0][0].data;
      expect(data.modalPrice).toBe(1500);
      expect(data.minPrice).toBe(1500); // defaults to modal when not supplied
      expect(data.maxPrice).toBe(1500);
      expect(data.trendIndicator).toBe(TrendIndicator.UP);
      // Card carries the visual cue for the listic UI.
      expect(card.trend).toEqual({ indicator: TrendIndicator.UP, arrow: '▲', color: 'green' });
      expect(card.price.display).toBe('₹1,500/box');
    });

    it('updates the existing same-day row instead of appending a duplicate', async () => {
      mockPrisma.mandiPrice.findFirst
        .mockResolvedValueOnce(null) // prior benchmark -> STABLE
        .mockResolvedValueOnce({ id: 'mp-today' }); // same-day row exists
      mockPrisma.mandiPrice.update.mockResolvedValue({
        id: 'mp-today',
        mandiName: base.mandiName,
        commodity: base.commodity,
        variety: null,
        regionId: null,
        minPrice: 1500,
        maxPrice: 1500,
        modalPrice: 1500,
        unitOfSale: 'box',
        currency: 'INR',
        trendIndicator: TrendIndicator.STABLE,
        audioPrompts: null,
        recordedAt: new Date(),
      });

      await service.recordDailyPrice(base);

      expect(mockPrisma.mandiPrice.update).toHaveBeenCalledTimes(1);
      expect(mockPrisma.mandiPrice.update.mock.calls[0][0].where).toEqual({ id: 'mp-today' });
      expect(mockPrisma.mandiPrice.create).not.toHaveBeenCalled();
    });

    it('honours an explicit trendIndicator override without a prior lookup', async () => {
      mockPrisma.mandiPrice.findFirst.mockResolvedValue(null); // only the same-day check runs
      mockPrisma.mandiPrice.create.mockResolvedValue({
        id: 'mp-x',
        mandiName: base.mandiName,
        commodity: base.commodity,
        variety: null,
        regionId: null,
        minPrice: 1500,
        maxPrice: 1500,
        modalPrice: 1500,
        unitOfSale: 'box',
        currency: 'INR',
        trendIndicator: TrendIndicator.DOWN,
        audioPrompts: null,
        recordedAt: new Date(),
      });

      await service.recordDailyPrice({ ...base, trendIndicator: TrendIndicator.DOWN });

      const data = mockPrisma.mandiPrice.create.mock.calls[0][0].data;
      expect(data.trendIndicator).toBe(TrendIndicator.DOWN);
      // Override means the prior-benchmark lookup is skipped; only the same-day check fires.
      expect(mockPrisma.mandiPrice.findFirst).toHaveBeenCalledTimes(1);
    });
  });

  describe('findLatestRegionalPrices', () => {
    it('keeps only the latest row per board+commodity+variety and shapes listic cards', async () => {
      mockPrisma.mandiPrice.findMany.mockResolvedValue([
        {
          id: 'today',
          mandiName: 'Sopore Fruit Mandi',
          commodity: 'Apple - Delicious',
          variety: 'Delicious',
          regionId: 'reg-1',
          minPrice: 1100,
          maxPrice: 1800,
          modalPrice: 1450,
          unitOfSale: 'box',
          currency: 'INR',
          trendIndicator: TrendIndicator.DOWN,
          audioPrompts: { KASHMIRI: 'k' },
          recordedAt: new Date('2026-09-26T00:00:00Z'),
        },
        {
          id: 'yesterday',
          mandiName: 'Sopore Fruit Mandi',
          commodity: 'Apple - Delicious',
          variety: 'Delicious',
          regionId: 'reg-1',
          minPrice: 1000,
          maxPrice: 1700,
          modalPrice: 1500,
          unitOfSale: 'box',
          currency: 'INR',
          trendIndicator: TrendIndicator.UP,
          audioPrompts: null,
          recordedAt: new Date('2026-09-25T00:00:00Z'),
        },
      ]);

      const cards = await service.findLatestRegionalPrices({ regionId: 'reg-1' });

      expect(cards).toHaveLength(1);
      expect(cards[0].id).toBe('today'); // newest wins
      expect(cards[0].trend).toEqual({
        indicator: TrendIndicator.DOWN,
        arrow: '▼',
        color: 'red',
      });
      expect(cards[0].price.modal).toBe(1450);
      expect(cards[0].audioPrompts).toEqual({ KASHMIRI: 'k' });
    });
  });
});
