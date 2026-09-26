/**
 * Thin API client for the farmer-facing app. Only the calls the Voice-First /
 * Listic UI needs live here. Auth is a Bearer JWT; the voice endpoint is
 * FARMER-only (see AiAssistantController), so the token must be attached.
 */
import type { VoiceQueryResponseDto } from './types';

/** Base URL of the API (global prefix included). Wire to env in the real app. */
const API_BASE_URL =
  (typeof process !== 'undefined' && process.env?.API_BASE_URL) ||
  'http://localhost:3000/api/v1';

/**
 * Supplies the current access token. Swapped for the real secure-storage /
 * auth-context accessor at integration time — kept injectable so these stubs
 * don't hard-depend on any particular state library.
 */
let tokenProvider: () => string | null | Promise<string | null> = () => null;

export function setAuthTokenProvider(provider: typeof tokenProvider): void {
  tokenProvider = provider;
}

/**
 * Uploads a recorded audio clip to the voice-to-voice assistant and returns the
 * transcript, reply text, and a playable reply-audio URL.
 *
 * The backend reads the raw bytes from the `audio` multipart field (see
 * FileInterceptor('audio')) and derives the farmer's identity + language from
 * the token — nothing about the user is sent in the body.
 */
export async function askVoiceAssistant(
  audioBlob: Blob,
): Promise<VoiceQueryResponseDto> {
  const form = new FormData();
  // Filename + type help the server-side file-type validator; extension is
  // cosmetic — mimetype is what ParseFilePipeBuilder checks.
  const ext = mimeToExt(audioBlob.type);
  form.append('audio', audioBlob, `query.${ext}`);

  const token = await tokenProvider();

  const res = await fetch(`${API_BASE_URL}/assistant/voice`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form, // do NOT set Content-Type; the browser adds the multipart boundary
  });

  if (!res.ok) {
    const detail = await safeReadError(res);
    throw new VoiceAssistantError(res.status, detail);
  }

  return (await res.json()) as VoiceQueryResponseDto;
}

/** Error carrying the HTTP status so the UI can branch (401 -> re-auth, etc.). */
export class VoiceAssistantError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'VoiceAssistantError';
  }
}

function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'audio/webm': 'webm',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'audio/m4a': 'm4a',
    'audio/wav': 'wav',
  };
  return map[mime] ?? 'webm';
}

async function safeReadError(res: Response): Promise<string> {
  try {
    const body = await res.json();
    return body?.message ?? res.statusText;
  } catch {
    return res.statusText;
  }
}
