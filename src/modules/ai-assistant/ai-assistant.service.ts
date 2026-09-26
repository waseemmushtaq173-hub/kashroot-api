import { Injectable, Logger, NotImplementedException } from '@nestjs/common';
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
 * MVP is synchronous (see AiAssistantController). Each stage is stubbed below so
 * the transport + auth + DI wiring can be verified before the ML plumbing lands.
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

  // --- Pipeline stages (stubbed — free tooling, wired in a follow-up) ---

  private async speechToText(
    _audio: Buffer,
    _mimeType: string,
    _language: PreferredLanguage,
  ): Promise<string> {
    // TODO: POST to Bhashini ASR (Whisper fallback). Returns the transcript.
    throw new NotImplementedException('STT pipeline not yet implemented.');
  }

  private async askAssistant(
    _transcript: string,
    _userId: string,
    _language: PreferredLanguage,
  ): Promise<string> {
    // TODO: prompt a self-hosted open LLM with farmer context; reply in `language`.
    throw new NotImplementedException('LLM pipeline not yet implemented.');
  }

  private async textToSpeech(_text: string, _language: PreferredLanguage): Promise<string> {
    // TODO: Bhashini TTS (Coqui fallback) -> upload to object storage -> return URL.
    throw new NotImplementedException('TTS pipeline not yet implemented.');
  }
}
