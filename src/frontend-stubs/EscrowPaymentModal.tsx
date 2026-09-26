/**
 * EscrowPaymentModal — the farmer-facing payment drawer for a single escrow
 * milestone (money held, released, refunded, disputed). Escrow moves real money
 * for someone who may not read, so trust rides on the SPOKEN audit trail:
 *
 *   - Visual UI stays English (amount "₹1,450", status "Held in escrow",
 *     order id). We never machine-translate this chrome.
 *   - On open — and whenever the escrow event changes — the drawer AUTO-PLAYS
 *     the localized spoken audit clip in the farmer's `preferredLanguage`
 *     (falling back Hindi → English → any). The farmer hears exactly what
 *     happened to their money without touching anything.
 *   - A "Play again" control repeats the same clip; a fallback-language hint
 *     appears when we couldn't synthesize their own language.
 *
 * The audit clip URLs come from the backend EscrowVoiceNotificationService,
 * surfaced on the EscrowUpdate contract.
 */
import { useCallback, useEffect, useRef } from 'react';

import type { EscrowStatus, EscrowUpdate, PreferredLanguage } from './types';
import { LANGUAGE_LABELS, isFallbackLanguage, pickSpokenClip } from './lib/spoken-audio';

interface EscrowPaymentModalProps {
  open: boolean;
  update: EscrowUpdate;
  /** The farmer's language — picks the spoken audit clip to auto-play. */
  preferredLanguage: PreferredLanguage;
  onClose: () => void;
}

export function EscrowPaymentModal({
  open,
  update,
  preferredLanguage,
  onClose,
}: EscrowPaymentModalProps) {
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const clip = pickSpokenClip(update.audioPrompts, preferredLanguage);
  const usingFallback = isFallbackLanguage(clip, preferredLanguage);

  const play = useCallback(() => {
    if (!clip) return;
    audioRef.current?.pause();
    const audio = new Audio(clip.url);
    audioRef.current = audio;
    void audio.play().catch(() => undefined);
  }, [clip]);

  // Auto-play the spoken audit the moment the drawer opens or the event changes.
  // Keyed on the resolved URL + orderId + status so viewing a NEW milestone
  // re-announces, but a re-render of the same event does not spam audio.
  useEffect(() => {
    if (!open || !clip) return;
    play();
    return () => audioRef.current?.pause();
  }, [open, clip, play, update.orderId, update.status]);

  if (!open) return null;

  const visual = STATUS_VISUALS[update.status];

  return (
    <div style={overlayStyle} role="presentation" onClick={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Escrow update for order ${update.orderId}`}
        style={drawerStyle}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Status badge — English label + glyph + colour (never colour alone). */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <span aria-hidden style={{ fontSize: 40 }}>
            {visual.glyph}
          </span>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: visual.color }}>
              {visual.label}
            </div>
            <div style={{ fontSize: 14, color: '#94a3b8' }}>Order {update.orderId}</div>
          </div>
        </div>

        {/* Hero amount */}
        <div style={{ fontSize: 56, fontWeight: 800, lineHeight: 1.05 }}>
          {formatMoney(update.amount, update.currency)}
        </div>

        {/* English summary for sighted/literate users. */}
        <p style={{ fontSize: 16, color: '#475569', margin: 0 }}>{update.summary}</p>

        {/* Spoken audit — auto-plays; button repeats it. */}
        <button
          type="button"
          onClick={play}
          disabled={!clip}
          aria-label={
            clip
              ? `Play the spoken audit again${
                  usingFallback ? ` in ${LANGUAGE_LABELS[clip.language]}` : ''
                }`
              : 'Spoken audit not available yet'
          }
          style={{ ...playStyle, opacity: clip ? 1 : 0.4 }}
        >
          <span aria-hidden style={{ fontSize: 28 }}>
            🔊
          </span>
          <span style={{ fontSize: 18, fontWeight: 700 }}>Play again</span>
          {usingFallback && clip ? (
            <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.85 }}>
              (in {LANGUAGE_LABELS[clip.language]})
            </span>
          ) : null}
        </button>

        <button type="button" onClick={onClose} style={closeStyle}>
          Close
        </button>
      </div>
    </div>
  );
}

const STATUS_VISUALS: Record<EscrowStatus, { glyph: string; color: string; label: string }> = {
  INITIATED: { glyph: '🟡', color: '#b45309', label: 'Payment initiated' },
  HELD: { glyph: '🔒', color: '#0d47a1', label: 'Held in escrow' },
  RELEASED: { glyph: '✅', color: '#1b8a3a', label: 'Released to you' },
  REFUNDED: { glyph: '↩️', color: '#9e9e9e', label: 'Refunded to buyer' },
  DISPUTED: { glyph: '⚠️', color: '#d32f2f', label: 'Under dispute' },
};

function formatMoney(value: string, currency: string): string {
  const n = Number(value);
  if (Number.isNaN(n)) return `${currency} ${value}`;
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${n.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15,23,42,0.55)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 50,
};

const drawerStyle: React.CSSProperties = {
  width: '100%',
  maxWidth: 480,
  display: 'flex',
  flexDirection: 'column',
  gap: 16,
  padding: 24,
  borderRadius: '24px 24px 0 0',
  background: '#fff',
  boxShadow: '0 -8px 32px rgba(0,0,0,0.25)',
};

const playStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 10,
  width: '100%',
  minHeight: 60,
  borderRadius: 16,
  border: 'none',
  background: '#0d47a1',
  color: '#fff',
  cursor: 'pointer',
};

const closeStyle: React.CSSProperties = {
  width: '100%',
  minHeight: 48,
  borderRadius: 12,
  border: '1px solid #cbd5e1',
  background: '#fff',
  color: '#475569',
  fontWeight: 600,
  cursor: 'pointer',
};
