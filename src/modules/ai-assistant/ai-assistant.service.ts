import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';
import {
  OrderStatus,
  PreferredLanguage,
  TrendIndicator,
  WeatherSeverity,
} from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';
import { AdvisoryService } from '../advisory/advisory.service';
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
 * Each stage calls a real provider when its env vars are configured, and falls
 * back to a deterministic offline stand-in otherwise (so dev + tests need no
 * external services). Provider selection is invisible to the controller:
 *   - STT: Bhashini ASR (BHASHINI_API_KEY + BHASHINI_ASR_URL). Kashmiri/Urdu/
 *          Hindi/English models. Stand-in: length-keyed sample utterance.
 *   - LLM: OpenAI or Gemini (LLM_PROVIDER + LLM_API_KEY + LLM_MODEL). Stand-in:
 *          the deterministic keyword router grounded in the farmer's own live
 *          platform state (mandi prices, weather alerts, active orders, advisories).
 *   - TTS: Bhashini TTS (BHASHINI_API_KEY + BHASHINI_TTS_URL). Stand-in: a
 *          deterministic mock CDN URL keyed by language + a hash of the text.
 *
 * MVP is synchronous (see AiAssistantController). The transport, auth, DI wiring
 * and end-to-end contract are exercised for real; the Bhashini compute endpoints
 * are dropped in via env once provisioned — no code change needed.
 */
@Injectable()
export class AiAssistantService {
  private readonly logger = new Logger(AiAssistantService.name);

  // --- Provider config. When a key/URL is unset the deterministic offline
  //     stand-in for that stage is used, so dev + tests run with no external
  //     services and real providers are enabled purely by setting env vars. ---
  private readonly llmApiKey?: string;
  private readonly llmProvider: string;
  private readonly llmModel: string;
  private readonly llmApiUrl?: string;
  private readonly bhashiniApiKey?: string;
  private readonly bhashiniAsrUrl?: string;
  private readonly bhashiniTtsUrl?: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly advisory: AdvisoryService,
    private readonly config: ConfigService,
  ) {
    this.llmApiKey = this.config.get<string>('LLM_API_KEY');
    this.llmProvider = this.config.get<string>('LLM_PROVIDER', 'openai');
    this.llmModel = this.config.get<string>('LLM_MODEL', 'gpt-4o-mini');
    this.llmApiUrl = this.config.get<string>('LLM_API_URL');
    this.bhashiniApiKey = this.config.get<string>('BHASHINI_API_KEY');
    this.bhashiniAsrUrl = this.config.get<string>('BHASHINI_ASR_URL');
    this.bhashiniTtsUrl = this.config.get<string>('BHASHINI_TTS_URL');
  }

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
    if (this.bhashiniApiKey && this.bhashiniAsrUrl) {
      try {
        return await this.bhashiniAsr(audio, mimeType, language);
      } catch (err) {
        this.logger.warn(
          `[STT] Bhashini ASR failed, falling back to simulation: ${(err as Error).message}`,
        );
      }
    }
    return this.speechToTextSimulated(audio, mimeType, language);
  }

  /** Deterministic offline stand-in, used until BHASHINI_ASR_URL is configured. */
  private speechToTextSimulated(
    audio: Buffer,
    mimeType: string,
    language: PreferredLanguage,
  ): string {
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
    if (this.llmApiKey) {
      try {
        return await this.llmReply(transcript, context);
      } catch (err) {
        this.logger.warn(
          `[LLM] live model call failed, falling back to grounded router: ${(err as Error).message}`,
        );
      }
    }
    return this.askAssistantSimulated(transcript, context);
  }

  /**
   * Deterministic grounded router — the offline stand-in used until LLM_API_KEY
   * is configured, and the fallback whenever a live model call fails.
   */
  private async askAssistantSimulated(transcript: string, context: FarmerContext): Promise<string> {
    this.logger.debug(
      `[LLM] simulating local model for farmer=${context.farmerProfileId ?? 'unknown'}, ` +
        `region=${context.regionId ?? 'unknown'}, lang=${context.language}`,
    );

    const q = transcript.toLowerCase();

    // Agronomy knowledge base — checked first so specific farming questions
    // ("how do I spray for scab?") are grounded in verified advisories rather
    // than swallowed by the broader intents below. Keywords include Hindi/Urdu/
    // Kashmiri transliterations a voice transcript may carry.
    if (
      /\b(spray|disease|scab|prune|pruning|fungicide|fertilizer|fertiliser|pest|bimari|dawa|koshur|leaf)\b/.test(
        q,
      )
    ) {
      return this.answerAgronomy(transcript, context);
    }
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

  /**
   * Grounded agronomy reply: queries the Spoken Agronomy Knowledge Base for the
   * advisory most relevant to the farmer's question and speaks its verified
   * guidance. The reply text is composed here (English) and synthesized into the
   * farmer's language by the TTS stage — the advisory's own pre-rendered clips
   * are used by the Farmer Portal knowledge feed, not this conversational path.
   */
  private async answerAgronomy(transcript: string, context: FarmerContext): Promise<string> {
    const advisory = await this.advisory.searchRelevantAdvisory(transcript, context.regionId);

    if (!advisory) {
      return (
        'I could not find a verified advisory for that yet. You can browse the ' +
        'Farming Knowledge feed for spray schedules, pest control, and orchard tips, ' +
        'or ask an expert.'
      );
    }

    // Government-verified advisories lead with an official marker so the farmer
    // hears the authority behind the guidance; others cite the source at the end.
    if (advisory.isGovVerified) {
      return (
        `According to the latest advisory from ${advisory.sourceOrganization}: ` +
        `${advisory.content} Open the Farming Knowledge feed to listen to the full ` +
        'official advisory.'
      );
    }

    return (
      `Here is verified guidance on ${advisory.topic}. ${advisory.content} ` +
      `This advice is from ${advisory.sourceOrganization}. Open the Farming Knowledge ` +
      'feed to listen to the full advisory.'
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
    if (this.bhashiniApiKey && this.bhashiniTtsUrl) {
      try {
        return await this.bhashiniTts(text, language);
      } catch (err) {
        this.logger.warn(
          `[TTS] Bhashini synthesis failed, falling back to simulation: ${(err as Error).message}`,
        );
      }
    }
    return this.textToSpeechSimulated(text, language);
  }

  /** Deterministic offline stand-in, used until BHASHINI_TTS_URL is configured. */
  private textToSpeechSimulated(text: string, language: PreferredLanguage): string {
    const clipId = createHash('sha1').update(`${language}:${text}`).digest('hex').slice(0, 16);
    this.logger.debug(`[TTS] simulating Bhashini synthesis: lang=${language}, clip=${clipId}`);

    return `https://cdn.mock.local/tts/${language.toLowerCase()}/${clipId}.mp3`;
  }

  // --- Live provider wrappers (used only when the matching env vars are set) ---

  /**
   * Build a grounded prompt from the farmer's transcript + resolved context and
   * ask the configured LLM (OpenAI or Gemini). The reply is generated directly
   * in the farmer's language for the TTS stage to synthesize.
   */
  private async llmReply(transcript: string, context: FarmerContext): Promise<string> {
    const system =
      'You are the Kashroot farming assistant for smallholder farmers in Kashmir. ' +
      `Reply in ${this.languageName(context.language)}. Keep it short, plain and ` +
      'practical (2-3 sentences) and suitable for text-to-speech playback. You help ' +
      'with mandi prices, weather, orders and agronomy; if unsure, tell the farmer ' +
      'to open the relevant screen in the app.';
    const user =
      `Farmer question (voice transcript): "${transcript}". ` +
      `Region id: ${context.regionId ?? 'unknown'}.`;
    return this.callLlm(system, user);
  }

  private languageName(language: PreferredLanguage): string {
    const names: Record<string, string> = {
      KASHMIRI: 'Kashmiri',
      URDU: 'Urdu',
      HINDI: 'Hindi',
      ENGLISH: 'English',
    };
    return names[language] ?? 'English';
  }

  private async callLlm(system: string, user: string): Promise<string> {
    return this.llmProvider.toLowerCase() === 'gemini'
      ? this.callGemini(system, user)
      : this.callOpenAi(system, user);
  }

  private async callOpenAi(system: string, user: string): Promise<string> {
    const base = (this.llmApiUrl || 'https://api.openai.com/v1').replace(/\/$/, '');
    const res = await fetch(`${base}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.llmApiKey}`,
      },
      body: JSON.stringify({
        model: this.llmModel,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
        temperature: 0.3,
        max_tokens: 300,
      }),
    });
    if (!res.ok) {
      throw new Error(`OpenAI HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const json: any = await res.json();
    const text = json?.choices?.[0]?.message?.content;
    if (typeof text !== 'string' || !text.trim()) throw new Error('OpenAI returned empty content');
    return text.trim();
  }

  private async callGemini(system: string, user: string): Promise<string> {
    const base = (this.llmApiUrl || 'https://generativelanguage.googleapis.com/v1beta').replace(
      /\/$/,
      '',
    );
    const model = this.llmModel && this.llmModel.startsWith('gemini') ? this.llmModel : 'gemini-1.5-flash';
    const res = await fetch(`${base}/models/${model}:generateContent?key=${this.llmApiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: [{ role: 'user', parts: [{ text: user }] }],
        generationConfig: { temperature: 0.3, maxOutputTokens: 300 },
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    const json: any = await res.json();
    const parts = json?.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p: any) => p?.text ?? '').join('').trim();
    if (!text) throw new Error('Gemini returned empty content');
    return text;
  }

  /** PreferredLanguage → Bhashini / ISO-639 language code. */
  private langToBhashiniCode(language: PreferredLanguage): string {
    const codes: Record<string, string> = {
      KASHMIRI: 'ks',
      URDU: 'ur',
      HINDI: 'hi',
      ENGLISH: 'en',
    };
    return codes[language] ?? 'hi';
  }

  /** Shared Bhashini POST helper: JSON body + inference-key auth + error surfacing. */
  private async postJson(url: string, body: unknown): Promise<any> {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Bhashini inference key. Some deployments expect a different header
        // (e.g. plain `Authorization`); set BHASHINI_API_KEY to match the endpoint.
        Authorization: this.bhashiniApiKey as string,
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Bhashini HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    }
    return res.json();
  }

  /**
   * Bhashini ASR wrapper. POSTs the base64 audio to BHASHINI_ASR_URL with a ULCA
   * pipeline payload and returns the decoded transcript. The endpoint + pipeline
   * ids are provisioned later — transport, auth and payload shape are wired now.
   */
  private async bhashiniAsr(
    audio: Buffer,
    mimeType: string,
    language: PreferredLanguage,
  ): Promise<string> {
    const sourceLanguage = this.langToBhashiniCode(language);
    const payload = {
      pipelineTasks: [
        {
          taskType: 'asr',
          config: {
            language: { sourceLanguage },
            audioFormat: mimeType.split('/')[1] || 'webm',
            samplingRate: 16000,
          },
        },
      ],
      inputData: { audio: [{ audioContent: audio.toString('base64') }] },
    };
    const json = await this.postJson(this.bhashiniAsrUrl as string, payload);
    const transcript =
      json?.pipelineResponse?.[0]?.output?.[0]?.source ??
      json?.output?.[0]?.source ??
      json?.transcript;
    if (typeof transcript !== 'string' || !transcript.trim()) {
      throw new Error('Bhashini ASR returned no transcript');
    }
    return transcript.trim();
  }

  /**
   * Bhashini TTS wrapper. POSTs the reply text to BHASHINI_TTS_URL and returns a
   * playable audio URL. Bhashini may instead return base64 audioContent — in that
   * case upload it to object storage (S3/GCS) here and return the resulting URL.
   */
  private async bhashiniTts(text: string, language: PreferredLanguage): Promise<string> {
    const targetLanguage = this.langToBhashiniCode(language);
    const payload = {
      pipelineTasks: [
        {
          taskType: 'tts',
          config: { language: { sourceLanguage: targetLanguage }, gender: 'female' },
        },
      ],
      inputData: { input: [{ source: text }] },
    };
    const json = await this.postJson(this.bhashiniTtsUrl as string, payload);
    const audio = json?.pipelineResponse?.[0]?.audio?.[0] ?? json?.audio?.[0];
    const url = audio?.audioUri ?? audio?.audioUrl;
    if (typeof url !== 'string' || !url) {
      throw new Error('Bhashini TTS returned no audio URL (base64 responses need a storage upload)');
    }
    return url;
  }
}
