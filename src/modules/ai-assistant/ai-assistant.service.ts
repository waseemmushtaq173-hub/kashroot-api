import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  OrderStatus,
  PreferredLanguage,
  TrendIndicator,
  WeatherSeverity,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { VoiceQueryResponseDto } from './dto/voice-query-response.dto';

export interface VoiceQueryInput {
  /** Authenticated user id (from req.user.sub — never the request body). */
  userId: string;
  /** Raw uploaded audio bytes (multer memory storage). */
  audioBuffer: Buffer;
  /** MIME type of the upload, e.g. 'audio/webm'. */
  mimeType: string;
}

/**
 * Resolved platform context for one farmer, assembled once per query and passed
 * to the LLM routing stage so every reply is grounded in that farmer's own
 * region, orders, and language rather than generic boilerplate.
 */
interface FarmerContext {
  farmerProfileId: string | null;
  regionId: string | null;
  language: PreferredLanguage;
}

/** Order states that count as "in flight" for the assistant's order summary. */
const ACTIVE_ORDER_STATUSES: OrderStatus[] = [
  OrderStatus.PLACED,
  OrderStatus.CONFIRMED,
  OrderStatus.PACKED,
  OrderStatus.SHIPPED,
  OrderStatus.CUSTOMS_CLEARANCE,
  OrderStatus.OUT_FOR_DELIVERY,
];

/**
 * Voice-to-voice assistant pipeline for the farmer-facing app.
 *
 * Design constraint: NO paid third-party APIs. The pipeline is built around
 * free / self-hostable / government tooling:
 *   - STT: Bhashini (Govt. of India ASR, has Kashmiri/Urdu/Hindi models),
 *          with self-hosted OpenAI Whisper as the offline fallback.
 *   - LLM: a self-hosted open model (e.g. Llama / Mistral via Ollama) — swap
 *          behind this service; the controller never sees the provider.
 *   - TTS: Bhashini TTS, with Coqui TTS as the self-hosted fallback.
 *   - Storage: object storage (S3/GCS/MinIO) for the generated reply audio.
 *
 * MVP is synchronous (see AiAssistantController). Each stage below is a
 * deterministic SIMULATION of the real provider call: the transport + auth + DI
 * wiring and the end-to-end contract are exercised for real, while the actual
 * Bhashini / LLM HTTP calls are swapped in later behind these same signatures.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  constructor(private readonly prisma: PrismaService) {}

  async handleVoiceQuery(input: VoiceQueryInput): Promise<VoiceQueryResponseDto> {
    const context = await this.resolveFarmerContext(input.userId);
    const { language } = context;

    // 1. STT — transcribe the farmer's speech in their language.
    const transcript = await this.speechToText(input.audioBuffer, input.mimeType, language);

    // 2. LLM — answer, grounded with the farmer's own platform context
    //    (region weather, local mandi prices, active orders).
    const replyText = await this.askAssistant(transcript, context);

    // 3. TTS — synthesize the reply back into the same language.
    // 4. Store the audio and hand back a URL the frontend auto-plays.
    const audioReplyUrl = await this.textToSpeech(replyText, language);

    return { transcript, replyText, audioReplyUrl, language };
  }

  /**
   * Resolve the farmer's profile once: their id (for order lookups), their home
   * region (for weather + mandi lookups), and their preferred language. Falls
   * back to KASHMIRI with null ids when no farmer profile exists for the user.
   */
  private async resolveFarmerContext(userId: string): Promise<FarmerContext> {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: { userId },
      select: { id: true, originRegionId: true, preferredLanguage: true },
    });
    return {
      farmerProfileId: profile?.id ?? null,
      regionId: profile?.originRegionId ?? null,
      language: profile?.preferredLanguage ?? PreferredLanguage.KASHMIRI,
    };
  }

  // --- Pipeline stages (simulated free tooling; real HTTP calls wired in a follow-up) ---

  /**
   * Bhashini ASR simulation. A real call POSTs the audio bytes to the Bhashini
   * pipeline for `language` (Whisper as the offline fallback) and returns the
   * decoded transcript. Here we can't decode audio, so we deterministically pick
   * a representative farmer utterance from the buffer's length — enough to prove
   * the transcript is data-dependent and to drive the intent router below.
   */
  private async speechToText(
    audio: Buffer,
    mimeType: string,
    language: PreferredLanguage,
  ): Promise<string> {
    this.logger.debug(
      `[STT] simulating Bhashini ASR: ${audio.length} bytes, ${mimeType}, lang=${language}`,
    );

    // Placeholder utterances the mock ASR can "hear" (English gloss of the
    // farmer's speech). Real Bhashini returns text in the source language.
    const utterances = [
      'What is the mandi rate for apple today?',
      'Tell me the weather forecast for my region.',
      'How do I list my walnut harvest for sale?',
    ];
    return utterances[audio.length % utterances.length];
  }

  /**
   * Local LLM simulation. A real call prompts a self-hosted open model (Ollama)
   * with the transcript + the farmer's own context and asks it to answer in
   * `context.language`. For the MVP we route on keywords to grounding helpers
   * that read live platform state (weather alerts, mandi prices, active orders)
   * and compose the reply — the "prompt wrapper" a real model would receive.
   */
  private async askAssistant(transcript: string, context: FarmerContext): Promise<string> {
    this.logger.debug(
      `[LLM] simulating local model for farmer=${context.farmerProfileId ?? 'unknown'}, ` +
        `region=${context.regionId ?? 'unknown'}, lang=${context.language}`,
    );

    const q = transcript.toLowerCase();

    if (/\b(mandi|price|rate|bhaav|daam)\b/.test(q)) {
      return this.answerMandiPrices(context);
    }
    if (/\b(weather|rain|snow|storm|forecast|mausam)\b/.test(q)) {
      return this.answerWeather(context);
    }
    if (/\b(order|orders|shipment|delivery|parcel|consignment)\b/.test(q)) {
      return this.answerActiveOrders(context);
    }

    return (
      "I can help with today's mandi prices, the weather forecast, or your " +
      'active orders. Please say "mandi", "weather", or "orders".'
    );
  }

  /** Grounded mandi reply: the latest recorded rate for the farmer's region. */
  private async answerMandiPrices(context: FarmerContext): Promise<string> {
    const price = await this.prisma.mandiPrice.findFirst({
      where: context.regionId ? { regionId: context.regionId } : {},
      orderBy: { recordedAt: 'desc' },
      select: {
        commodity: true,
        mandiName: true,
        modalPrice: true,
        unitOfSale: true,
        currency: true,
        trendIndicator: true,
      },
    });

    if (!price) {
      return (
        "I don't have today's mandi rates for your region yet. Please open the " +
        'Mandi Prices screen again a little later.'
      );
    }

    const trendWord =
      price.trendIndicator === TrendIndicator.UP
        ? 'up'
        : price.trendIndicator === TrendIndicator.DOWN
          ? 'down'
          : 'steady';
    const amount = this.formatMoney(Number(price.modalPrice), price.currency);

    return (
      `Today at ${price.mandiName}, ${price.commodity} is trading around ` +
      `${amount} per ${price.unitOfSale} — ${trendWord} versus yesterday. ` +
      'Open the Mandi Prices screen to hear the full list for your region.'
    );
  }

  /** Grounded weather reply: the most severe active alert for the farmer's region. */
  private async answerWeather(context: FarmerContext): Promise<string> {
    if (!context.regionId) {
      return (
        'I could not find your region, so I cannot fetch a local forecast. ' +
        'Please set your region in your profile.'
      );
    }

    const now = new Date();
    const alert = await this.prisma.weatherAlert.findFirst({
      where: {
        regionId: context.regionId,
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
      },
      // Enum sorts by declaration order (INFO < WARNING < CRITICAL): desc = most severe first.
      orderBy: [{ severityLevel: 'desc' }, { effectiveFrom: 'desc' }],
      select: { title: true, message: true, severityLevel: true },
    });

    if (!alert) {
      return 'There are no active weather alerts for your region right now.';
    }

    const prefix =
      alert.severityLevel === WeatherSeverity.CRITICAL
        ? 'Urgent weather alert: '
        : alert.severityLevel === WeatherSeverity.WARNING
          ? 'Weather warning: '
          : '';

    return `${prefix}${alert.title}. ${alert.message} Check the Weather Alerts screen for the full advisory.`;
  }

  /** Grounded orders reply: a count + latest status of the farmer's in-flight orders. */
  private async answerActiveOrders(context: FarmerContext): Promise<string> {
    if (!context.farmerProfileId) {
      return 'I could not find your farmer profile, so I cannot check your orders.';
    }

    const orders = await this.prisma.order.findMany({
      where: {
        farmerProfileId: context.farmerProfileId,
        status: { in: ACTIVE_ORDER_STATUSES },
      },
      orderBy: { updatedAt: 'desc' },
      select: { status: true },
    });

    if (orders.length === 0) {
      return 'You have no active orders right now. New orders will appear on the Orders screen.';
    }

    const latest = orders[0].status.toLowerCase().replace(/_/g, ' ');
    const plural = orders.length === 1 ? 'order' : 'orders';
    return (
      `You have ${orders.length} active ${plural}. The most recent one is ` +
      `currently "${latest}". Open the Orders screen to hear each one.`
    );
  }

  /** Localised money string (₹ for INR, else "<amount> <currency>"). */
  private formatMoney(amount: number, currency: string): string {
    return currency === 'INR'
      ? `₹${amount.toLocaleString('en-IN')}`
      : `${amount.toLocaleString('en-IN')} ${currency}`;
  }

  /**
   * Bhashini TTS simulation. A real call synthesizes `text` into speech in
   * `language` (Coqui as the self-hosted fallback), uploads the clip to object
   * storage, and returns a playable URL. We return a deterministic mock URL,
   * keyed by language + a hash of the text so identical replies map to one clip.
   */
  private async textToSpeech(text: string, language: PreferredLanguage): Promise<string> {
    const clipId = createHash('sha1').update(`${language}:${text}`).digest('hex').slice(0, 16);
    this.logger.debug(`[TTS] simulating Bhashini synthesis: lang=${language}, clip=${clipId}`);

    return `https://cdn.mock.local/tts/${language.toLowerCase()}/${clipId}.mp3`;
  }
}
