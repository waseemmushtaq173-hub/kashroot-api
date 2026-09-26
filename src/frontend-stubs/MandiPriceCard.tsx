/**
 * MandiPriceCard — one official APMC benchmark, rendered for a farmer who may
 * not read. This is the canonical "English UI + 4-Language Spoken Audio" card:
 *
 *   - ALL visible text stays English by default — commodity ("Apple -
 *     Delicious"), price ("₹1,450 / box"), mandi name ("Sopore Fruit Mandi").
 *     We never machine-translate the UI.
 *   - The modal price is the hero: biggest thing on the card.
 *   - Trend is a single huge colour-coded arrow (green up / red down / grey
 *     dash), never a word — colour is backed by glyph + audio, never alone.
 *   - A prominent, LABELLED "Listen" speaker plays the pre-rendered clip in the
 *     farmer's `preferredLanguage`, falling back to Hindi → English → any other
 *     synthesized language so they always hear the price aloud.
 */
import { useCallback, useRef } from 'react';

import type { MandiPrice, PreferredLanguage, TrendIndicator } from './types';
import { LANGUAGE_LABELS, isFallbackLanguage, pickSpokenClip } from './lib/spoken-audio';

interface MandiPriceCardProps {
  price: MandiPrice;
  /** The viewing farmer's language — selects which audio clip the speaker plays. */
  preferredLanguage: PreferredLanguage;
}

export function MandiPriceCard({ price, preferredLanguage }: MandiPriceCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);

  // Resolve the spoken clip with graceful fallback (preferred → Hindi →
  // English → any). Never index audioPrompts[lang] directly.
  const clip = pickSpokenClip(price.audioPrompts, preferredLanguage);
  const usingFallback = isFallbackLanguage(clip, preferredLanguage);

  const playClip = useCallback(() => {
    if (!clip) return;
    audioRef.current?.pause();
    const audio = new Audio(clip.url);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  }, [clip]);

  const trend = TREND_VISUALS[price.trendIndicator];

  return (
    <section style={cardStyle} aria-label={`${price.commodity} at ${price.mandiName}`}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ flex: 1 }}>
          {/* English UI: mandi + commodity labels are never translated. */}
          <div style={{ fontSize: 15, color: '#94a3b8', fontWeight: 600 }}>
            {price.mandiName}
          </div>
          <div style={{ fontSize: 20, color: '#555' }}>
            {price.commodity}
            {price.variety ? ` - ${price.variety}` : ''}
          </div>

          {/* Hero: modal price */}
          <div style={{ fontSize: 64, fontWeight: 800, lineHeight: 1.05 }}>
            {formatMoney(price.modalPrice, price.currency)}
          </div>
          <div style={{ fontSize: 18, color: '#777' }}>per {price.unitOfSale}</div>
        </div>

        {/* Trend arrow */}
        <div
          role="img"
          aria-label={trend.label}
          style={{ fontSize: 88, color: trend.color, padding: '0 12px' }}
        >
          {trend.glyph}
        </div>
      </div>

      {/* Prominent, labelled Listen control — the farmer's primary way in. */}
      <button
        type="button"
        onClick={playClip}
        disabled={!clip}
        aria-label={
          clip
            ? `Listen to this price${usingFallback ? ` in ${LANGUAGE_LABELS[clip.language]}` : ''}`
            : 'Audio not available yet'
        }
        style={{ ...listenStyle, opacity: clip ? 1 : 0.4 }}
      >
        <span aria-hidden style={{ fontSize: 30 }}>
          🔊
        </span>
        <span style={{ fontSize: 20, fontWeight: 700 }}>Listen</span>
        {usingFallback && clip ? (
          <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>
            (in {LANGUAGE_LABELS[clip.language]})
          </span>
        ) : null}
      </button>
    </section>
  );
}

const TREND_VISUALS: Record<TrendIndicator, { glyph: string; color: string; label: string }> = {
  UP: { glyph: '▲', color: '#1b8a3a', label: 'Price is up from yesterday' },
  DOWN: { glyph: '▼', color: '#d32f2f', label: 'Price is down from yesterday' },
  STABLE: { glyph: '—', color: '#9e9e9e', label: 'Price is unchanged from yesterday' },
};

function formatMoney(value: string, currency: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return `${currency} ${value}`;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const cardStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 14,
  padding: 20,
  borderRadius: 20,
  background: '#fff',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  maxWidth: 560,
};

const listenStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  minHeight: 64,
  borderRadius: 16,
  border: 'none',
  background: '#0d47a1',
  color: '#fff',
  cursor: 'pointer',
};
