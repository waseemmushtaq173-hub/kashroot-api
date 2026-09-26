import { Test, TestingModule } from '@nestjs/testing';
import { AdvisoryCategory } from '@prisma/client';

import { AdvisoryService } from './advisory.service';
import { GovAdvisorySyncService } from './gov-advisory-sync.service';
import { PrismaService } from '../../prisma/prisma.service';
import { CreateAdvisoryDto } from './dto/create-advisory.dto';

describe('AdvisoryService (spoken agronomy knowledge base)', () => {
  let service: AdvisoryService;

  const mockPrisma = {
    farmingAdvisory: {
      create: jest.fn(),
      update: jest.fn(),
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
    sourceOrganization: 'SKUAST-Kashmir',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AdvisoryService, { provide: PrismaService, useValue: mockPrisma }],
    }).compile();

    service = module.get<AdvisoryService>(AdvisoryService);
    mockPrisma.farmingAdvisory.create.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'adv-1', createdAt: new Date(), updatedAt: new Date(), ...data }),
    );
    mockPrisma.farmingAdvisory.update.mockImplementation(({ data }: any) =>
      Promise.resolve({ id: 'adv-existing', createdAt: new Date(), updatedAt: new Date(), ...data }),
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
      // Author-created advisories default to NOT gov-verified.
      expect(created.isGovVerified).toBe(false);
      expect(mockPrisma.farmingAdvisory.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            applicableCrops: ['Apple'],
            sourceOrganization: 'SKUAST-Kashmir',
            isGovVerified: false,
          }),
        }),
      );
    });
  });

  describe('findAdvisories', () => {
    it('filters by crop and orders gov-verified first, then newest', async () => {
      mockPrisma.farmingAdvisory.findMany.mockResolvedValue([]);
      await service.findAdvisories({ crop: 'Apple' });

      expect(mockPrisma.farmingAdvisory.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { applicableCrops: { has: 'Apple' } },
          orderBy: [{ isGovVerified: 'desc' }, { updatedAt: 'desc' }],
        }),
      );
    });
  });

  describe('upsertGovAdvisory', () => {
    const govItem = {
      topic: 'SKUAST-K Alert: Apple Scab Infection Window Open',
      category: AdvisoryCategory.GOV_ALERT,
      content: 'Apply a protective Mancozeb spray before the forecast rain.',
      applicableCrops: ['Apple'],
      applicableRegions: ['Sopore'],
      sourceOrganization: 'SKUAST-Kashmir',
      sourceUrl: 'https://www.skuastkashmir.ac.in/advisories/apple-scab-window',
    };

    it('creates a new gov advisory (isGovVerified) when the topic is absent', async () => {
      mockPrisma.farmingAdvisory.findFirst.mockResolvedValue(null);

      const { advisory, created } = await service.upsertGovAdvisory(govItem);

      expect(created).toBe(true);
      expect((advisory as any).isGovVerified).toBe(true);
      expect((advisory as any).sourceOrganization).toBe('SKUAST-Kashmir');
      expect(mockPrisma.farmingAdvisory.update).not.toHaveBeenCalled();
    });

    it('updates in place (no duplicate) when the topic already exists', async () => {
      mockPrisma.farmingAdvisory.findFirst.mockResolvedValue({ id: 'adv-existing' });

      const { created } = await service.upsertGovAdvisory(govItem);

      expect(created).toBe(false);
      expect(mockPrisma.farmingAdvisory.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'adv-existing' },
          data: expect.objectContaining({ isGovVerified: true }),
        }),
      );
      expect(mockPrisma.farmingAdvisory.create).not.toHaveBeenCalled();
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

describe('GovAdvisorySyncService (live government advisory ingest)', () => {
  let sync: GovAdvisorySyncService;

  const mockAdvisory = {
    upsertGovAdvisory: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        GovAdvisorySyncService,
        { provide: AdvisoryService, useValue: mockAdvisory },
      ],
    }).compile();

    sync = module.get<GovAdvisorySyncService>(GovAdvisorySyncService);
  });

  afterEach(() => jest.clearAllMocks());

  it('ingests every fetched gov advisory as a verified upsert, counting new vs refreshed', async () => {
    // First alert is new, the rest already existed and are refreshed in place.
    mockAdvisory.upsertGovAdvisory
      .mockResolvedValueOnce({ advisory: { id: 'g1' }, created: true })
      .mockResolvedValue({ advisory: { id: 'g2' }, created: false });

    const result = await sync.syncLiveGovAdvisories();

    expect(result.total).toBeGreaterThan(0);
    expect(result.created).toBe(1);
    expect(result.updated).toBe(result.total - 1);
    expect(mockAdvisory.upsertGovAdvisory).toHaveBeenCalledTimes(result.total);
    // Every ingested item is routed through the gov (verified) upsert path.
    expect(mockAdvisory.upsertGovAdvisory).toHaveBeenCalledWith(
      expect.objectContaining({ sourceOrganization: expect.any(String) }),
    );
  });

  it('does not abort the whole sync when one advisory fails to ingest', async () => {
    mockAdvisory.upsertGovAdvisory
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValue({ advisory: { id: 'g' }, created: true });

    const result = await sync.syncLiveGovAdvisories();

    // The failed item is skipped; the remaining ones still ingest.
    expect(result.created).toBe(result.total - 1);
    expect(result.updated).toBe(0);
  });
});
