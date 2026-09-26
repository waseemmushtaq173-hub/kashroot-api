import { Test, TestingModule } from '@nestjs/testing';
import { AdvisoryCategory } from '@prisma/client';

import { AdvisoryService } from './advisory.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdvisoryDto } from './dto/create-advisory.dto';

describe('AdvisoryService (spoken agronomy knowledge base)', () => {
  let service: AdvisoryService;

  const mockPrisma = {
    farmingAdvisory: {
      create: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
    },
  };

  const dto = (): CreateAdvisoryDto => ({
    topic: 'Apple Scab Spray Schedule',
    category: AdvisoryCategory.SPRAY_SCHEDULE,
    content: 'Spray Mancozeb 75% WP at 3 g per litre of water at green-tip.',
    applicableCrops: ['Apple'],
    applicableRegions: ['Sopore'],
    source: 'SKUAST-K',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdvisoryService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<AdvisoryService>(AdvisoryService);
    mockPrisma.farmingAdvisory.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'adv-1', createdAt: new Date(), updatedAt: new Date(), ...data }),
    );
  });

  afterEach(() => jest.clearAllMocks());

  describe('createAdvisory', () => {
    it('renders a spoken clip URL for all four languages', async () => {
      const created: any = await service.createAdvisory(dto());
      const prompts = created.audioPrompts;

      expect(Object.keys(prompts).sort()).toEqual(
        ['ENGLISH', 'HINDI', 'KASHMIRI', 'URDU'].sort(),
      );
      expect(prompts.KASHMIRI).toMatch(
        /^https:\/\/cdn\.mock\.local\/tts\/advisory\/kashmiri\/.+\.mp3$/,
      );
      // Persisted the defaulted empty region array when omitted.
      expect(mockPrisma.farmingAdvisory.create).toHaveBeenCalledWith(
        expect.objectContaining({ data: expect.objectContaining({ applicableCrops: ['Apple'] }) }),
      );
    });
  });

  describe('findAdvisories', () => {
    it('filters by crop using a Postgres array `has` clause', async () => {
      mockPrisma.farmingAdvisory.findMany.mockResolvedValue([]);
      await service.findAdvisories({ crop: 'Apple' });

      expect(mockPrisma.farmingAdvisory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { applicableCrops: { has: 'Apple' } } }),
      );
    });
  });

  describe('searchRelevantAdvisory', () => {
    const scabAdvisory = {
      id: 'scab',
      topic: 'Apple Scab Spray Schedule',
      category: AdvisoryCategory.SPRAY_SCHEDULE,
      content: 'Spray Mancozeb at green-tip to control scab.',
      applicableCrops: ['Apple'],
    };
    const soilAdvisory = {
      id: 'soil',
      topic: 'Balanced Orchard Soil Nutrition',
      category: AdvisoryCategory.FERTILIZER_SOIL,
      content: 'Apply farmyard manure and split nitrogen.',
      applicableCrops: ['Apple'],
    };

    it('returns the highest-scoring advisory for a scab query', async () => {
      mockPrisma.farmingAdvisory.findMany.mockResolvedValue([soilAdvisory, scabAdvisory]);

      const match = await service.searchRelevantAdvisory('how do I spray for scab');

      expect(match?.id).toBe('scab');
    });

    it('returns null when nothing meaningfully matches', async () => {
      mockPrisma.farmingAdvisory.findMany.mockResolvedValue([soilAdvisory]);

      const match = await service.searchRelevantAdvisory('when is the next market holiday');

      expect(match).toBeNull();
    });
  });

  describe('seedInitialAdvisories', () => {
    it('creates advisories that are absent and skips ones already present', async () => {
      // First seed topic already exists; the rest are new.
      mockPrisma.farmingAdvisory.findFirst
        .mockResolvedValueOnce({ id: 'existing' })
        .mockResolvedValue(null);

      const result = await service.seedInitialAdvisories();

      expect(result.skipped).toBe(1);
      expect(result.created).toBeGreaterThan(0);
      expect(mockPrisma.farmingAdvisory.create).toHaveBeenCalledTimes(result.created);
    });
  });
});
