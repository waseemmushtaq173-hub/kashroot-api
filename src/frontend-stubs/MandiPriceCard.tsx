/**
 * MandiPriceCard — one official APMC benchmark, rendered for a farmer who may
 * not read. Listic UI rules:
 *   - The modal price is the hero: biggest thing on the card.
 *   - Trend is a single huge colour-coded arrow (green up / red down / grey
 *     dash), never a word.
 *   - A big speaker button plays the pre-rendered local-language clip.
 * Text labels remain for sighted/literate users and screen readers, but the
 * card is fully usable from colour + arrow + audio alone.
 */
import { useCallback, useRef } from 'react';

import type { MandiPrice, PreferredLanguage, TrendIndicator } from './types';

interface MandiPriceCardProps {
  price: MandiPrice;
  /** The viewing farmer's language — selects which audio clip the speaker plays. */
  preferredLanguage: PreferredLanguage;
}

export function MandiPriceCard({ price, preferredLanguage }: MandiPriceCardProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clipUrl = price.audioPrompts?.[preferredLanguage] ?? null;

  const playClip = useCallback(() => {
    if (!clipUrl) return;
    audioRef.current?.pause();
    const audio = new Audio(clipUrl);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  }, [clipUrl]);

  const trend = TREND_VISUALS[price.trendIndicator];

  return (
    <section style={cardStyle} aria-label={`${price.commodity} at ${price.mandiName}`}>
      <div style={{ flex: 1 }}>
        <div style={{ fontSize: 20, color: '#555' }}>{price.commodity}</div>

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

      {/* Speaker — play the local-language clip */}
      <button
        type="button"
        onClick={playClip}
        disabled={!clipUrl}
        aria-label={
          clipUrl ? 'Play price in your language' : 'Audio not available in your language'
        }
        style={{ ...speakerStyle, opacity: clipUrl ? 1 : 0.4 }}
      >
        <span aria-hidden style={{ fontSize: 44 }}>
          🔊
        </span>
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
  alignItems: 'center',
  gap: 12,
  padding: 20,
  borderRadius: 20,
  background: '#fff',
  boxShadow: '0 4px 16px rgba(0,0,0,0.12)',
  maxWidth: 560,
};

const speakerStyle: React.CSSProperties = {
  width: 84,
  height: 84,
  borderRadius: '50%',
  border: 'none',
  background: '#0d47a1',
  color: '#fff',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
};
