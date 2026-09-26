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
});
