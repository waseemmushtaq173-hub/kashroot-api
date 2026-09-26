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

/** AgroGuard counterfeit-detection verdict (mirrors InspectionVerdict). */
export type InspectionVerdict = 'GENUINE_FACTORY' | 'SUSPICIOUS_COUNTERFEIT';

/** Packaging flaws the scan pipeline detected against the golden reference. */
export interface DiscrepancyReport {
  logoMismatch: boolean;
  hologramMismatch: boolean;
  unlistedBatch: boolean;
  missingSeal: boolean;
  fontMismatches: string[];
}

/**
 * Result of POST /api/v1/tester/inspect. Carries the verdict + confidence, the
 * detected discrepancies, and the AUTHENTIC manufacturer guidance (with
 * per-language spoken dosage clips) so the tester always has the real dosage.
 */
export interface AgencyInspectionResult {
  inspectionId: string;
  verdict: InspectionVerdict;
  matchConfidence: number; // 0..1
  brand: string;
  manufacturerName: string;
  discrepancyReport: DiscrepancyReport;
  verifiedInstructions: {
    chemicalComposition: string;
    targetCrops: string;
    dosageInstructions: string;
    audioPrompts?: Partial<Record<PreferredLanguage, string>> | null;
  };
}

/** Knowledge-base bucket (mirrors the backend AdvisoryCategory enum). */
export type AdvisoryCategory =
  | 'SPRAY_SCHEDULE'
  | 'DISEASE_PEST'
  | 'FERTILIZER_SOIL'
  | 'MODERN_TECH'
  | 'GOV_ALERT';

/**
 * One verified farming advisory from GET /api/v1/advisories. Visual text stays
 * English; `audioPrompts` carries the per-language spoken clip the knowledge
 * feed plays via lib/spoken-audio.ts (a language key may be absent).
 * `isGovVerified` advisories are live-synced from official bodies (SKUAST-K,
 * ICAR, Dept. of Horticulture) and carry an "Official Gov Advisory" badge.
 */
export interface FarmingAdvisory {
  id: string;
  topic: string;
  category: AdvisoryCategory;
  content: string;
  applicableCrops: string[];
  applicableRegions: string[];
  isGovVerified: boolean;
  sourceOrganization: string;
  sourceUrl?: string | null;
  audioPrompts?: Partial<Record<PreferredLanguage, string>> | null;
  createdAt: string; // ISO timestamp
  updatedAt: string; // ISO timestamp
}
