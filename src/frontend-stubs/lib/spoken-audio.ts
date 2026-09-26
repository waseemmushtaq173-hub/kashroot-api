/**
 * spoken-audio — the single home of the "English UI + 4-Language Spoken Audio"
 * rule. Kashroot never machine-translates the visual UI: commodity names,
 * prices and mandi boards stay in English for everyone. What DOES adapt to the
 * farmer's `preferredLanguage` is the *spoken* layer — the pre-rendered audio
 * clips behind every Listen button and the escrow audit drawer.
 *
 * Because a clip may not have been synthesized in every language yet, callers
 * must never index `audioPrompts[lang]` directly; they go through
 * `pickSpokenClip`, which walks a graceful fallback chain so the farmer always
 * hears *something* intelligible rather than silence.
 */
import type { PreferredLanguage } from '../types';

/** Map of language -> pre-rendered clip URL, as the backend surfaces it. */
export type AudioPrompts = Partial<Record<PreferredLanguage, string>> | null | undefined;

/**
 * Fallback order when the farmer's own language clip is missing. Hindi is the
 * widest-understood second language across J&K, then English as the universal
 * backstop; the remaining two fill the tail so any available clip wins over
 * silence.
 */
const FALLBACK_ORDER: readonly PreferredLanguage[] = [
  'HINDI',
  'ENGLISH',
  'URDU',
  'KASHMIRI',
];

/**
 * Resolve the best spoken clip for a farmer: their preferred language first,
 * then Hindi, then English, then anything present. Returns `null` only when the
 * map is empty/absent — the caller should disable the Listen control in that
 * (rare) case.
 */
export function pickSpokenClip(
  prompts: AudioPrompts,
  preferredLanguage: PreferredLanguage,
): { url: string; language: PreferredLanguage } | null {
  if (!prompts) return null;

  const tryLangs: PreferredLanguage[] = [preferredLanguage, ...FALLBACK_ORDER];
  for (const lang of tryLangs) {
    const url = prompts[lang];
    if (url) return { url, language: lang };
  }
  return null;
}

/**
 * True when the resolved clip is NOT in the farmer's own language — lets the UI
 * add a small "(in Hindi)" hint so the mismatch isn't surprising.
 */
export function isFallbackLanguage(
  resolved: { language: PreferredLanguage } | null,
  preferredLanguage: PreferredLanguage,
): boolean {
  return !!resolved && resolved.language !== preferredLanguage;
}

/** Human-readable label for a language, for the tiny fallback hint / a11y. */
export const LANGUAGE_LABELS: Record<PreferredLanguage, string> = {
  KASHMIRI: 'Kashmiri',
  URDU: 'Urdu',
  HINDI: 'Hindi',
  ENGLISH: 'English',
};
