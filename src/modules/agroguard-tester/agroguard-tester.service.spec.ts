import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { InspectionVerdict } from '@prisma/client';

import { AgroGuardTesterService } from './agroguard-tester.service';
import { PrismaService } from '../../prisma/prisma.service';

/** Authentic "Superstar" baseline the scans are compared against. */
const GOLDEN_SUPERSTAR = {
  id: 'ref-1',
  brandName: 'Superstar',
  manufacturerName: 'FIL Industries',
  chemicalComposition: 'Gibberellic Acid (GA3) 1.8% + micronutrient blend',
  targetCrops: 'Apple',
  factoryBatchPrefix: 'FIL-SS-',
  factoryHologramPattern: 'FIL-HOLO-3D-STAR',
  goldenImageUrl: 'https://cdn.mock.local/agroguard/golden/superstar.png',
  dosageInstructions: 'Spray for leaf vigour and fruit finish, 1-1.5 ml/L of water.',
  audioPrompts: { ENGLISH: 'https://cdn.mock.local/tts/agroguard/english/superstar-abc.mp3' },
};

describe('AgroGuardTesterService', () => {
  let service: AgroGuardTesterService;
  let prisma: {
    testerProfile: { findUnique: jest.Mock };
    industryGoldenReference: { findUnique: jest.Mock; upsert: jest.Mock };
    agencyPesticideInspection: { create: jest.Mock; findMany: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      testerProfile: { findUnique: jest.fn() },
      industryGoldenReference: { findUnique: jest.fn(), upsert: jest.fn() },
      agencyPesticideInspection: {
        create: jest.fn().mockImplementation(({ data }) =>
          Promise.resolve({ id: 'insp-1', ...data }),
        ),
        findMany: jest.fn(),
      },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AgroGuardTesterService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get(AgroGuardTesterService);
  });

  describe('compareAgencyProduct', () => {
    it('flags a matching Superstar bottle as GENUINE_FACTORY with full confidence', async () => {
      prisma.industryGoldenReference.findUnique.mockResolvedValue(GOLDEN_SUPERSTAR);

      const result = await service.compareAgencyProduct('tester-1', {
        agencyName: 'Green Agro Center',
        productBrand: 'Superstar',
        scannedBatchNo: 'FIL-SS-2024-0012',
        scannedBottleImageUrl: 'https://x/genuine.png',
        observedHologramPattern: 'FIL-HOLO-3D-STAR',
        logoMatchesFactory: true,
        sealPresent: true,
        fontAnomalies: [],
      });

      expect(result.verdict).toBe(InspectionVerdict.GENUINE_FACTORY);
      expect(result.matchConfidence).toBe(1);
      expect(result.discrepancyReport).toEqual({
        logoMismatch: false,
        hologramMismatch: false,
        unlistedBatch: false,
        missingSeal: false,
        fontMismatches: [],
      });
      // Authentic dosage is always surfaced.
      expect(result.verifiedInstructions.dosageInstructions).toContain('1-1.5 ml/L');
      expect(prisma.agencyPesticideInspection.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            verdict: InspectionVerdict.GENUINE_FACTORY,
            matchConfidence: 1,
          }),
        }),
      );
    });

    it('flags a fake Superstar (bad logo + unlisted batch + no seal) as SUSPICIOUS_COUNTERFEIT', async () => {
      prisma.industryGoldenReference.findUnique.mockResolvedValue(GOLDEN_SUPERSTAR);

      const result = await service.compareAgencyProduct('tester-1', {
        agencyName: 'Cheap Corner Shop',
        productBrand: 'Superstar',
        scannedBatchNo: 'XYZ-999',
        scannedBottleImageUrl: 'https://x/fake.png',
        observedHologramPattern: 'BLURRY-STAR',
        logoMatchesFactory: false,
        sealPresent: false,
        fontAnomalies: ['brand kerning off'],
      });

      expect(result.verdict).toBe(InspectionVerdict.SUSPICIOUS_COUNTERFEIT);
      expect(result.matchConfidence).toBeLessThan(0.7);
      expect(result.discrepancyReport).toMatchObject({
        logoMismatch: true,
        hologramMismatch: true,
        unlistedBatch: true,
        missingSeal: true,
        fontMismatches: ['brand kerning off'],
      });
    });

    it('throws NotFound when the brand has no golden reference', async () => {
      prisma.industryGoldenReference.findUnique.mockResolvedValue(null);

      await expect(
        service.compareAgencyProduct('tester-1', {
          agencyName: 'Some Shop',
          productBrand: 'GhostBrand',
          scannedBottleImageUrl: 'https://x/g.png',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.agencyPesticideInspection.create).not.toHaveBeenCalled();
    });

    it('throws BadRequest when neither an uploaded image nor a URL is given', async () => {
      prisma.industryGoldenReference.findUnique.mockResolvedValue(GOLDEN_SUPERSTAR);

      await expect(
        service.compareAgencyProduct('tester-1', {
          agencyName: 'Some Shop',
          productBrand: 'Superstar',
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('getInspectionHistory', () => {
    it('returns the tester’s audits newest first', async () => {
      const rows = [{ id: 'insp-2' }, { id: 'insp-1' }];
      prisma.agencyPesticideInspection.findMany.mockResolvedValue(rows);

      const history = await service.getInspectionHistory('tester-1');

      expect(history).toBe(rows);
      expect(prisma.agencyPesticideInspection.findMany).toHaveBeenCalledWith({
        where: { testerProfileId: 'tester-1' },
        orderBy: { createdAt: 'desc' },
      });
    });
  });

  describe('seedIndustryGoldenReferences', () => {
    it('upserts the Superstar baseline with spoken dosage prompts', async () => {
      prisma.industryGoldenReference.upsert.mockImplementation(({ create }) =>
        Promise.resolve({ id: 'ref-1', ...create }),
      );

      await service.seedIndustryGoldenReferences();

      const call = prisma.industryGoldenReference.upsert.mock.calls[0][0];
      expect(call.where).toEqual({ brandName: 'Superstar' });
      expect(call.create.manufacturerName).toBe('FIL Industries');
      expect(call.create.factoryBatchPrefix).toBe('FIL-SS-');
      expect(Object.keys(call.create.audioPrompts)).toEqual(
        expect.arrayContaining(['KASHMIRI', 'URDU', 'HINDI', 'ENGLISH']),
      );
    });
  });

  describe('resolveTesterProfileId', () => {
    it('returns the profile id for a tester user', async () => {
      prisma.testerProfile.findUnique.mockResolvedValue({ id: 'tester-1' });
      await expect(service.resolveTesterProfileId('user-1')).resolves.toBe('tester-1');
    });

    it('throws NotFound when the user has no tester profile', async () => {
      prisma.testerProfile.findUnique.mockResolvedValue(null);
      await expect(service.resolveTesterProfileId('user-x')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });
});
