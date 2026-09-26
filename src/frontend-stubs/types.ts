/**
 * Frontend-side mirrors of the backend contracts. These intentionally duplicate
 * the Prisma enums / DTOs so the mobile+web client stays decoupled from the API
 * package; keep them in sync with:
 *   - PreferredLanguage / TrendIndicator      (prisma/schema.prisma)
 *   - VoiceQueryResponseDto                    (ai-assistant/dto)
 *   - MandiPrice                               (mandi-prices module)
 */

export type PreferredLanguage = 'KASHMIRI' | 'URDU' | 'HINDI' | 'ENGLISH';

export type TrendIndicator = 'UP' | 'DOWN' | 'STABLE';

/** Response of POST /api/v1/assistant/voice. */
export interface VoiceQueryResponseDto {
  /** What the farmer said, transcribed in their language. */
  transcript: string;
  /** The assistant's answer as text (rendered to audio by the server). */
  replyText: string;
  /** Playable URL of the synthesized reply — the client auto-plays this. */
  audioReplyUrl: string;
  /** Language the whole exchange was conducted in. */
  language: PreferredLanguage;
}

/**
 * A single official APMC benchmark row from GET /api/v1/mandi-prices.
 * `audioPrompts` is a per-language map of pre-rendered clip URLs; a key may be
 * absent if that language hasn't been synthesized yet.
 */
export interface MandiPrice {
  id: string;
  mandiName: string;
  commodity: string;
  variety?: string | null;
  minPrice: string; // Prisma Decimal serializes as string over JSON
  maxPrice: string;
  modalPrice: string;
  unitOfSale: string;
  currency: string;
  trendIndicator: TrendIndicator;
  audioPrompts?: Partial<Record<PreferredLanguage, string>> | null;
  recordedAt: string; // ISO timestamp
}

/**
 * Lifecycle of the money an escrow is guarding, mirrored from the backend
 * EscrowStatus enum. Drives the badge + which audit clip auto-plays.
 */
export type EscrowStatus =
  | 'INITIATED'
  | 'HELD'
  | 'RELEASED'
  | 'REFUNDED'
  | 'DISPUTED';

/**
 * One escrow milestone as shown in the farmer-facing payment drawer. The visual
 * fields (amount, status, order) stay English; `audioPrompts` carries the
 * per-language spoken audit clip the drawer auto-plays for this specific event,
 * produced by the backend EscrowVoiceNotificationService.
 */
export interface EscrowUpdate {
  orderId: string;
  status: EscrowStatus;
  /** Escrowed amount, Prisma Decimal serialized as string. */
  amount: string;
  currency: string;
  /** Short English summary of what just happened, for sighted users. */
  summary: string;
  /** Per-language spoken audit clip for THIS event (may be partially filled). */
  audioPrompts?: Partial<Record<PreferredLanguage, string>> | null;
  updatedAt: string; // ISO timestamp
}
