import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PreferredLanguage } from '@prisma/client';

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
    const language = await this.resolveLanguage(input.userId);

    // 1. STT — transcribe the farmer's speech in their language.
    const transcript = await this.speechToText(input.audioBuffer, input.mimeType, language);

    // 2. LLM — answer, grounded with the farmer's own context (region, listings…).
    const replyText = await this.askAssistant(transcript, input.userId, language);

    // 3. TTS — synthesize the reply back into the same language.
    // 4. Store the audio and hand back a URL the frontend auto-plays.
    const audioReplyUrl = await this.textToSpeech(replyText, language);

    return { transcript, replyText, audioReplyUrl, language };
  }

  /** Read the farmer's preferredLanguage; default KASHMIRI if no profile. */
  private async resolveLanguage(userId: string): Promise<PreferredLanguage> {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: { userId },
      select: { preferredLanguage: true },
    });
    return profile?.preferredLanguage ?? PreferredLanguage.KASHMIRI;
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
   * with the transcript + the farmer's own context (region, listings, role) and
   * asks it to answer in `language`. For the MVP we route on keywords to a small
   * set of hardcoded, grounded replies.
   */
  private async askAssistant(
    transcript: string,
    userId: string,
    language: PreferredLanguage,
  ): Promise<string> {
    this.logger.debug(`[LLM] simulating local model for user=${userId}, lang=${language}`);

    const q = transcript.toLowerCase();

    if (/\b(mandi|price|rate|bhaav|daam)\b/.test(q)) {
      return (
        'Today at Sopore Fruit Mandi, Apple (Delicious) is trading around ' +
        '₹1,450 per box — up slightly from yesterday. Open the Mandi Prices ' +
        'screen to hear the full list for your region.'
      );
    }

    if (/\b(weather|rain|snow|storm|forecast|mausam)\b/.test(q)) {
      return (
        'Light rain is expected in your region over the next two days. Cover ' +
        'harvested produce and delay spraying. Check the Weather Alerts screen ' +
        'for the detailed advisory.'
      );
    }

    return (
      "I can help with today's mandi prices, the weather forecast, or listing " +
      'your produce for sale. Please say "mandi", "weather", or "sell".'
    );
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
