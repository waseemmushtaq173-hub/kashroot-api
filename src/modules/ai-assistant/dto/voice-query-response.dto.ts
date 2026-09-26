import { PreferredLanguage } from '@prisma/client';

/**
 * Shape returned by POST /api/v1/assistant/voice.
 * The frontend needs only `audioReplyUrl` to auto-play; the text fields are
 * for on-screen captions / debugging and are safe to ignore on the client.
 */
export class VoiceQueryResponseDto {
  /** What STT heard — useful as an on-screen caption while audio plays. */
  transcript: string;

  /** The assistant's answer, in the farmer's resolved language. */
  replyText: string;

  /** TTS output the frontend auto-plays. */
  audioReplyUrl: string;

  /** Resolved language of the reply (audit + client hint). */
  language: PreferredLanguage;
}
