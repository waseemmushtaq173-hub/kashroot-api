import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { PreferredLanguage } from '@prisma/client';

import { PrismaService } from '../../prisma/prisma.service';

/** Escrow lifecycle events that trigger a spoken audit to the farmer. */
export type EscrowVoiceEvent = 'ESCROW_HELD' | 'ESCROW_RELEASED' | 'ESCROW_REFUNDED';

export interface EscrowVoiceNotificationInput {
  farmerProfileId: string;
  event: EscrowVoiceEvent;
  amount: number;
  currency?: string;
}

export interface EscrowVoiceNotification {
  language: PreferredLanguage;
  /** The composed spoken script (what the TTS engine will voice). */
  script: string;
  /** Playable audio URL from the (stubbed) Bhashini/Coqui TTS engine. */
  audioUrl: string;
}

/**
 * EscrowVoiceNotificationService — "Spoken Escrow Audits" trust loop.
 *
 * Turns each escrow money-movement into a short, culturally tailored spoken
 * message in the farmer's own language. Illiterate farmers never read a
 * balance; they HEAR, in a respectful register, that their money was secured,
 * paid out, or returned — closing the trust loop on every transaction.
 *
 * TTS is stubbed here (free Bhashini pipeline, Coqui fallback) and resolves a
 * deterministic audio URL; the composed script is what matters for review.
 */
@Injectable()
export class EscrowVoiceNotificationService {
  private readonly logger = new Logger(EscrowVoiceNotificationService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Compose + "synthesize" a spoken escrow audit for the farmer. Best-effort:
   * callers (EscrowService) invoke this AFTER the financial transaction commits,
   * so a TTS/lookup failure must never bubble up and undo settled money — hence
   * this method resolves to null on error rather than throwing.
   */
  async dispatchEscrowNotification(
    input: EscrowVoiceNotificationInput,
  ): Promise<EscrowVoiceNotification | null> {
    try {
      const language = await this.resolveLanguage(input.farmerProfileId);
      const script = this.composeScript(language, input.event, input.amount, input.currency ?? 'INR');
      const audioUrl = this.synthesize(language, input.event, script);

      this.logger.log(
        `Voice audit dispatched: farmer=${input.farmerProfileId} event=${input.event} lang=${language}`,
      );
      return { language, script, audioUrl };
    } catch (err) {
      // Never let a notification failure affect the escrow outcome.
      this.logger.error(
        `Voice audit failed for farmer=${input.farmerProfileId} event=${input.event}: ${String(err)}`,
      );
      return null;
    }
  }

  /** Read the farmer's preferredLanguage; default KASHMIRI if no profile. */
  private async resolveLanguage(farmerProfileId: string): Promise<PreferredLanguage> {
    const profile = await this.prisma.farmerProfile.findUnique({
      where: { id: farmerProfileId },
      select: { preferredLanguage: true },
    });
    return profile?.preferredLanguage ?? PreferredLanguage.KASHMIRI;
  }

  /** Build the localized, culturally respectful script for an event. */
  composeScript(
    language: PreferredLanguage,
    event: EscrowVoiceEvent,
    amount: number,
    currency: string,
  ): string {
    const t = VOICE_TEMPLATES[language];
    const money = formatAmount(amount, currency);
    return `${t.greeting}, ${t.honorific}. ${t.events[event](money)}`;
  }

  /** Stubbed Bhashini/Coqui TTS — deterministic mock clip URL per script+lang. */
  private synthesize(language: PreferredLanguage, event: EscrowVoiceEvent, script: string): string {
    const clipId = createHash('sha1').update(`${language}:${script}`).digest('hex').slice(0, 16);
    return `https://cdn.mock.local/tts/escrow/${language.toLowerCase()}/${event.toLowerCase()}-${clipId}.mp3`;
  }
}

function formatAmount(amount: number, currency: string): string {
  const symbol = currency === 'INR' ? '₹' : `${currency} `;
  return `${symbol}${amount.toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
}

interface LanguageTemplate {
  greeting: string;
  honorific: string;
  events: Record<EscrowVoiceEvent, (money: string) => string>;
}

/**
 * Culturally tailored spoken scripts, one set per supported language. K/U/H are
 * romanized here so the copy is reviewable; a localization pass swaps in native
 * script before the real TTS voices them. Honorifics: Kashmiri "Chacha" (uncle),
 * Urdu "Janab", Hindi "ji", English "respected farmer".
 */
const VOICE_TEMPLATES: Record<PreferredLanguage, LanguageTemplate> = {
  KASHMIRI: {
    greeting: 'Aadaab',
    honorific: 'Chacha',
    events: {
      ESCROW_HELD: (m) => `Tohi sund ${m} chu escrow manz mehfooz rakhmut. Fikr karyiv ne.`,
      ESCROW_RELEASED: (m) => `Mubarak! Tohi sund ${m} chu tohi hinz khaataas manz pounchmut.`,
      ESCROW_REFUNDED: (m) => `Tohi sund ${m} chu wapas karith. Paise chu poore mehfooz.`,
    },
  },
  URDU: {
    greeting: 'Aadaab',
    honorific: 'Janab',
    events: {
      ESCROW_HELD: (m) => `Aap ke ${m} escrow mein mehfooz rakh diye gaye hain. Fikar na karein.`,
      ESCROW_RELEASED: (m) => `Mubarak ho! Aap ke ${m} aap ke account mein bhej diye gaye hain.`,
      ESCROW_REFUNDED: (m) => `Aap ke ${m} wapas kar diye gaye hain. Paisa bilkul mehfooz hai.`,
    },
  },
  HINDI: {
    greeting: 'Namaste',
    honorific: 'ji',
    events: {
      ESCROW_HELD: (m) => `Aapke ${m} escrow mein surakshit rakhe gaye hain. Chinta na karein.`,
      ESCROW_RELEASED: (m) => `Badhai ho! Aapke ${m} aapke khaate mein bhej diye gaye hain.`,
      ESCROW_REFUNDED: (m) => `Aapke ${m} wapas kar diye gaye hain. Paisa poori tarah surakshit hai.`,
    },
  },
  ENGLISH: {
    greeting: 'Hello',
    honorific: 'respected farmer',
    events: {
      ESCROW_HELD: (m) => `Your ${m} has been safely held in escrow. There is nothing to worry about.`,
      ESCROW_RELEASED: (m) => `Good news! Your ${m} has been released to your account.`,
      ESCROW_REFUNDED: (m) => `Your ${m} has been refunded. Your money is fully safe.`,
    },
  },
};
