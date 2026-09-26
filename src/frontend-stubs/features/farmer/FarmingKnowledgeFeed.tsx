/**
 * FarmingKnowledgeFeed — the Spoken Agronomy Knowledge Base surface in the
 * Farmer Portal. Picture-driven "listic" cards of verified advisories (spray
 * schedules, pest control, soil, modern orchard tech), each with a prominent
 * "🔊 Listen" button that plays the advisory in the farmer's language via the
 * shared fallback chain (lib/spoken-audio.ts). Fast voice-prompt chips up top
 * let a non-reader fire a spoken question straight into the assistant.
 *
 * UI text stays English (see the spoken-audio spec); only the audio localizes.
 * Wired to GET /api/v1/advisories with a SAMPLE fallback so it's never blank.
 */
import { useEffect, useRef, useState } from 'react';

import { useAuth } from '../../auth/AuthContext';
import { API_BASE_URL } from '../../api';
import { LANGUAGE_LABELS, isFallbackLanguage, pickSpokenClip } from '../../lib/spoken-audio';
import type { AdvisoryCategory, FarmingAdvisory, PreferredLanguage } from '../../types';

/** Category → glyph + English label. Colour is paired with the glyph, never alone. */
const CATEGORY_VISUALS: Record<AdvisoryCategory, { icon: string; label: string; tint: string }> = {
  SPRAY_SCHEDULE: { icon: '💧', label: 'Spray schedule', tint: 'text-sky-700 bg-sky-50' },
  DISEASE_PEST: { icon: '🐛', label: 'Disease & pest', tint: 'text-red-700 bg-red-50' },
  FERTILIZER_SOIL: { icon: '🌱', label: 'Fertilizer & soil', tint: 'text-amber-700 bg-amber-50' },
  MODERN_TECH: { icon: '🚜', label: 'Modern tech', tint: 'text-emerald-700 bg-emerald-50' },
  GOV_ALERT: { icon: '📢', label: 'Government alert', tint: 'text-blue-700 bg-blue-50' },
};

/** Quick spoken prompts a farmer can tap instead of typing (fires the assistant). */
const VOICE_PROMPTS = [
  'How do I spray for apple scab?',
  'Tell me about pruning',
  'Which fertilizer for my soil?',
];

export function FarmingKnowledgeFeed() {
  const { user } = useAuth();
  const language = user?.preferredLanguage ?? 'KASHMIRI';
  const [advisories, setAdvisories] = useState<FarmingAdvisory[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    fetch(`${API_BASE_URL}/advisories`)
      .then((r) => (r.ok ? r.json() : Promise.reject(r.status)))
      .then((data: FarmingAdvisory[]) => active && setAdvisories(data))
      .catch(() => active && setAdvisories(SAMPLE_ADVISORIES))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="flex flex-col gap-5">
      <div>
        <h1 className="text-2xl font-bold text-brand-700">Farming Knowledge 🌱</h1>
        <p className="text-lg text-slate-600">
          Verified guidance from SKUAST-K & Horticulture — tap 🔊 to listen.
        </p>
      </div>

      {/* Fast voice-prompt chips — a non-reader taps one to ask by voice. */}
      <div className="flex flex-wrap gap-2">
        {VOICE_PROMPTS.map((p) => (
          <button
            key={p}
            type="button"
            className="rounded-full border border-brand-300 bg-brand-50 px-3 py-1.5 text-sm font-medium text-brand-700 hover:bg-brand-100"
            aria-label={`Ask the assistant: ${p}`}
          >
            🎙️ {p}
          </button>
        ))}
      </div>

      {loading ? (
        <p className="text-slate-500">Loading…</p>
      ) : (
        <div className="flex flex-col gap-4">
          {advisories.map((a) => (
            <AdvisoryCard key={a.id} advisory={a} preferredLanguage={language} />
          ))}
        </div>
      )}
    </div>
  );
}

/* ADVISORY_CARD_PLACEHOLDER */

function AdvisoryCard({
  advisory,
  preferredLanguage,
}: {
  advisory: FarmingAdvisory;
  preferredLanguage: PreferredLanguage;
}) {
  const visual = CATEGORY_VISUALS[advisory.category];
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clip = pickSpokenClip(advisory.audioPrompts, preferredLanguage);
  const usingFallback = isFallbackLanguage(clip, preferredLanguage);
  const fallbackLabel = usingFallback && clip ? LANGUAGE_LABELS[clip.language] : null;

  const listen = () => {
    if (!clip) return;
    audioRef.current?.pause();
    const audio = new Audio(clip.url);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  };

  return (
    <article className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        {advisory.isGovVerified ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-blue-600 px-2.5 py-0.5 text-xs font-semibold text-white">
            <span aria-hidden>🏛️</span> Official Gov Advisory
          </span>
        ) : null}
        <span
          className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ${visual.tint}`}
        >
          <span aria-hidden>{visual.icon}</span> {visual.label}
        </span>
        {advisory.applicableCrops.length > 0 ? (
          <span className="text-xs text-slate-500">{advisory.applicableCrops.join(', ')}</span>
        ) : null}
      </div>

      <h2 className="text-lg font-bold text-slate-800">{advisory.topic}</h2>
      <p className="mt-1 text-slate-700">{advisory.content}</p>
      <p className="mt-2 text-xs italic text-slate-400">
        Source: {advisory.sourceOrganization}
        {advisory.sourceUrl ? (
          <>
            {' · '}
            <a
              href={advisory.sourceUrl}
              target="_blank"
              rel="noreferrer"
              className="text-blue-600 underline"
            >
              official mandate
            </a>
          </>
        ) : null}
      </p>

      <button
        type="button"
        onClick={listen}
        disabled={!clip}
        className="mt-3 flex items-center gap-2 rounded-lg bg-brand-600 px-4 py-2 font-semibold text-white disabled:opacity-40"
        aria-label={
          clip
            ? `Listen to ${advisory.topic}${fallbackLabel ? ` in ${fallbackLabel}` : ''}`
            : 'Spoken advisory not available yet'
        }
      >
        <span aria-hidden>🔊</span> Listen
        {fallbackLabel ? (
          <span className="text-xs font-medium opacity-85">(in {fallbackLabel})</span>
        ) : null}
      </button>
    </article>
  );
}

const SAMPLE_ADVISORIES: FarmingAdvisory[] = [
  {
    id: 'sample-gov',
    topic: 'SKUAST-K Alert: Apple Scab Infection Window Open',
    category: 'GOV_ALERT',
    content:
      'Cool, wet weather over the next 72 hours has opened a high-risk scab infection ' +
      'window. Apply a protective Mancozeb 75% WP spray at 3 g per litre before the rain.',
    applicableCrops: ['Apple'],
    applicableRegions: ['Sopore', 'Shopian'],
    isGovVerified: true,
    sourceOrganization: 'SKUAST-Kashmir',
    sourceUrl: 'https://www.skuastkashmir.ac.in/advisories/apple-scab-window',
    audioPrompts: { KASHMIRI: 'https://cdn.mock.local/tts/advisory/kashmiri/gov-scab-k.mp3' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sample-scab',
    topic: 'Apple Scab Spray Schedule (Green Tip to Pink Bud)',
    category: 'SPRAY_SCHEDULE',
    content:
      'Start protective sprays at green-tip: Mancozeb 75% WP at 3 g per litre of water. ' +
      'Repeat at pink-bud and petal-fall, and again after every heavy rain.',
    applicableCrops: ['Apple'],
    applicableRegions: ['Sopore', 'Shopian'],
    isGovVerified: false,
    sourceOrganization: 'SKUAST-Kashmir',
    sourceUrl: null,
    audioPrompts: { KASHMIRI: 'https://cdn.mock.local/tts/advisory/kashmiri/scab-k.mp3' },
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
  {
    id: 'sample-hd',
    topic: 'High-Density Apple Planting (Modern Orchard)',
    category: 'MODERN_TECH',
    content:
      'High-density plantation on dwarfing rootstock with a trellis and drip irrigation ' +
      'gives earlier bearing and higher per-hectare yield than traditional orchards.',
    applicableCrops: ['Apple'],
    applicableRegions: ['Shopian'],
    isGovVerified: false,
    sourceOrganization: 'SKUAST-Kashmir High-Density Plantation Programme',
    sourceUrl: null,
    audioPrompts: null,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  },
];
