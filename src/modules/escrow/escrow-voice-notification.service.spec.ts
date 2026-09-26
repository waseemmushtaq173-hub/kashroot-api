import { Test, TestingModule } from '@nestjs/testing';
import { PreferredLanguage } from '@prisma/client';

import { EscrowVoiceNotificationService } from './escrow-voice-notification.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EscrowVoiceNotificationService', () => {
  let service: EscrowVoiceNotificationService;

  const mockPrisma = { farmerProfile: { findUnique: jest.fn() } };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowVoiceNotificationService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<EscrowVoiceNotificationService>(EscrowVoiceNotificationService);
  });

  afterEach(() => jest.clearAllMocks());

  // greeting + honorific that must appear for each language.
  const EXPECTATIONS: Array<[PreferredLanguage, string, string]> = [
    [PreferredLanguage.KASHMIRI, 'Aadaab', 'Chacha'],
    [PreferredLanguage.URDU, 'Aadaab', 'Janab'],
    [PreferredLanguage.HINDI, 'Namaste', 'ji'],
    [PreferredLanguage.ENGLISH, 'Hello', 'respected farmer'],
  ];

  describe('language + greeting selection', () => {
    it.each(EXPECTATIONS)(
      'uses the %s greeting and honorific from the farmer profile',
      async (language, greeting, honorific) => {
        mockPrisma.farmerProfile.findUnique.mockResolvedValue({ preferredLanguage: language });

        const result = await service.dispatchEscrowNotification({
          farmerProfileId: 'farmer-1',
          event: 'ESCROW_HELD',
          amount: 1450,
        });

        expect(result).not.toBeNull();
        expect(result!.language).toBe(language);
        expect(result!.script).toContain(greeting);
        expect(result!.script).toContain(honorific);
        // Audio URL is namespaced by language + event.
        expect(result!.audioUrl).toContain(`/tts/escrow/${language.toLowerCase()}/escrow_held-`);
      },
    );
  });

  describe('event-specific scripts', () => {
    beforeEach(() =>
      mockPrisma.farmerProfile.findUnique.mockResolvedValue({
        preferredLanguage: PreferredLanguage.ENGLISH,
      }),
    );

    it('speaks a "held" message with the formatted amount', () => {
      const script = service.composeScript(PreferredLanguage.ENGLISH, 'ESCROW_HELD', 1450, 'INR');
      expect(script).toContain('₹1,450');
      expect(script).toContain('held in escrow');
    });

    it('speaks a "released" message', () => {
      const script = service.composeScript(PreferredLanguage.ENGLISH, 'ESCROW_RELEASED', 1450, 'INR');
      expect(script).toContain('released');
    });

    it('speaks a "refunded" message', () => {
      const script = service.composeScript(PreferredLanguage.ENGLISH, 'ESCROW_REFUNDED', 1450, 'INR');
      expect(script).toContain('refunded');
    });
  });

  describe('resilience', () => {
    it('returns null (never throws) when the profile lookup fails', async () => {
      mockPrisma.farmerProfile.findUnique.mockRejectedValue(new Error('db down'));
      await expect(
        service.dispatchEscrowNotification({ farmerProfileId: 'x', event: 'ESCROW_HELD', amount: 1 }),
      ).resolves.toBeNull();
    });

    it('defaults to Kashmiri when the farmer has no profile', async () => {
      mockPrisma.farmerProfile.findUnique.mockResolvedValue(null);
      const result = await service.dispatchEscrowNotification({
        farmerProfileId: 'x',
        event: 'ESCROW_HELD',
        amount: 1,
      });
      expect(result!.language).toBe(PreferredLanguage.KASHMIRI);
    });
  });
});
