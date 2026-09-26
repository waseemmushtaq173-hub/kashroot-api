import { Test, TestingModule } from '@nestjs/testing';
import { PreferredLanguage, TrendIndicator, WeatherSeverity, OrderStatus } from '@prisma/client';

import { AiAssistantService, VoiceQueryInput } from './ai-assistant.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('AiAssistantService (voice-to-voice pipeline)', () => {
  let service: AiAssistantService;

  const mockPrisma = {
    farmerProfile: { findUnique: jest.fn() },
    mandiPrice: { findFirst: jest.fn() },
    weatherAlert: { findFirst: jest.fn() },
    order: { findMany: jest.fn() },
  };

  const input = (): VoiceQueryInput => ({
    userId: 'user-1',
    audioBuffer: Buffer.from('mock-audio'),
    mimeType: 'audio/webm',
  });

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AiAssistantService,
        { provide: PrismaService, useValue: mockPrisma },
      ],
    }).compile();

    service = module.get<AiAssistantService>(AiAssistantService);

    // Safe defaults: no data unless a test provides it.
    mockPrisma.mandiPrice.findFirst.mockResolvedValue(null);
    mockPrisma.weatherAlert.findFirst.mockResolvedValue(null);
    mockPrisma.order.findMany.mockResolvedValue([]);
  });

  afterEach(() => jest.clearAllMocks());

  /** Force the STT stage to yield a chosen transcript so we can drive any intent. */
  const withTranscript = (text: string) =>
    jest.spyOn(service as any, 'speechToText').mockResolvedValue(text);

  describe('language resolution', () => {
    it('resolves and echoes the farmer preferredLanguage (URDU)', async () => {
      mockPrisma.farmerProfile.findUnique.mockResolvedValue({
        id: 'farmer-1',
        originRegionId: 'reg-1',
        preferredLanguage: PreferredLanguage.URDU,
      });

      const res = await service.handleVoiceQuery(input());

      expect(mockPrisma.farmerProfile.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 'user-1' } }),
      );
      expect(res.language).toBe(PreferredLanguage.URDU);
      // TTS clip lives under the resolved-language namespace.
      expect(res.audioReplyUrl).toContain('/tts/urdu/');
    });

    it('defaults to KASHMIRI when the user has no farmer profile', async () => {
      mockPrisma.farmerProfile.findUnique.mockResolvedValue(null);

      const res = await service.handleVoiceQuery(input());

      expect(res.language).toBe(PreferredLanguage.KASHMIRI);
      expect(res.audioReplyUrl).toContain('/tts/kashmiri/');
    });
  });

  describe('grounded LLM routing + full pipeline', () => {
    beforeEach(() => {
      mockPrisma.farmerProfile.findUnique.mockResolvedValue({
        id: 'farmer-1',
        originRegionId: 'reg-1',
        preferredLanguage: PreferredLanguage.ENGLISH,
      });
    });

    it('mandi intent: grounds the reply in the latest regional rate', async () => {
      withTranscript('what is the mandi rate for apple today');
      mockPrisma.mandiPrice.findFirst.mockResolvedValue({
        commodity: 'Apple - Delicious',
        mandiName: 'Sopore Fruit Mandi',
        modalPrice: 1450,
        unitOfSale: 'box',
        currency: 'INR',
        trendIndicator: TrendIndicator.UP,
      });

      const res = await service.handleVoiceQuery(input());

      expect(mockPrisma.mandiPrice.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({ where: { regionId: 'reg-1' } }),
      );
      // Fully-populated DTO.
      expect(res.transcript).toBe('what is the mandi rate for apple today');
      expect(res.replyText).toContain('Sopore Fruit Mandi');
      expect(res.replyText).toContain('₹1,450');
      expect(res.replyText).toContain('up versus yesterday');
      expect(res.audioReplyUrl).toMatch(/^https:\/\/cdn\.mock\.local\/tts\/english\/.+\.mp3$/);
      expect(res.language).toBe(PreferredLanguage.ENGLISH);
    });

    it('weather intent: surfaces the most severe active regional alert', async () => {
      withTranscript('will there be rain, what is the weather forecast');
      mockPrisma.weatherAlert.findFirst.mockResolvedValue({
        title: 'Heavy snowfall expected',
        message: 'Protect orchards over the next 48 hours.',
        severityLevel: WeatherSeverity.CRITICAL,
      });

      const res = await service.handleVoiceQuery(input());

      expect(mockPrisma.weatherAlert.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ regionId: 'reg-1' }),
        }),
      );
      expect(res.replyText).toContain('Urgent weather alert:');
      expect(res.replyText).toContain('Heavy snowfall expected');
    });

    it('orders intent: counts the farmer active orders and names the latest status', async () => {
      withTranscript('what is the status of my order shipment');
      mockPrisma.order.findMany.mockResolvedValue([
        { status: OrderStatus.OUT_FOR_DELIVERY },
        { status: OrderStatus.CONFIRMED },
      ]);

      const res = await service.handleVoiceQuery(input());

      expect(mockPrisma.order.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ farmerProfileId: 'farmer-1' }),
        }),
      );
      expect(res.replyText).toContain('2 active orders');
      expect(res.replyText).toContain('out for delivery');
    });

    it('falls back to the spoken menu when no intent matches', async () => {
      withTranscript('hello, is anyone there');

      const res = await service.handleVoiceQuery(input());

      expect(res.replyText).toContain('Please say');
      expect(mockPrisma.mandiPrice.findFirst).not.toHaveBeenCalled();
      expect(mockPrisma.weatherAlert.findFirst).not.toHaveBeenCalled();
    });
  });
});
