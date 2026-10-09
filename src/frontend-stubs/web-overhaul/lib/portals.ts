/**
 * The three Kashroot portals and their bright glassmorphic palettes — the single
 * source of truth for the landing-page cards, the portal shells and their
 * headers. Replaces the old dark/black portal chrome.
 *
 *   escrow           Emerald Trust   — teal/emerald, "money is safe"
 *   mandi            Saffron Gold    — amber/orange, the Pampore harvest
 *   priceComparison  Dal Lake Azure  — sky/indigo, calm and analytical
 *
 * Every class below is a complete literal string. Tailwind only generates
 * classes it can find verbatim in source, so never assemble these from
 * fragments (`'bg-' + colour`).
 *
 * Contrast: headings are slate-900 and body copy slate-600 on surfaces no darker
 * than *-50/white, and every solid button clears WCAG AA (4.5:1) for its label.
 */

import { ScaleIcon, ShieldCheckIcon, TrendingUpIcon } from '@/components/ui/icons';

export type PortalId = 'escrow' | 'mandi' | 'priceComparison';

export interface PortalTheme {
  /** Full-page background behind the portal. */
  canvas: string;
  /** Two blurred colour fields floated behind the glass for depth. */
  glowA: string;
  glowB: string;
  /** Portal header surface. Light by design — see PriceComparisonHeader. */
  header: string;
  /** Small pill above the portal title. */
  eyebrow: string;
  /** Square tile holding the portal icon. */
  iconTile: string;
  /** Solid call-to-action. */
  primaryButton: string;
  /** Quiet call-to-action on glass. */
  secondaryButton: string;
}

export interface Portal {
  id: PortalId;
  title: string;
  eyebrow: string;
  description: string;
  /** Route of the portal dashboard in the web app — adjust to your routes. */
  href: string;
  icon: typeof ShieldCheckIcon;
  theme: PortalTheme;
}

/** Shared glass surfaces, so every portal's cards read as one system. */
export const GLASS = {
  /** Large frosted panel over a photograph or colour field. */
  panel:
    'bg-white/60 backdrop-blur-xl ring-1 ring-white/70 shadow-[0_8px_40px_rgba(15,23,42,0.10)]',
  /** Content card inside a portal — pair with text-slate-900 / text-slate-600. */
  card: 'rounded-3xl bg-white/70 backdrop-blur-xl ring-1 ring-slate-900/5 shadow-[0_8px_30px_rgba(15,23,42,0.06)]',
} as const;

export const PORTALS: Record<PortalId, Portal> = {
  escrow: {
    id: 'escrow',
    title: 'Escrow Protected Trade',
    eyebrow: 'Payments held safely',
    description:
      'Your money is held by Kashroot until the produce arrives and is accepted — no advance-payment risk on either side.',
    href: '/escrow',
    icon: ShieldCheckIcon,
    theme: {
      canvas: 'bg-gradient-to-br from-emerald-50 via-teal-50 to-cyan-50',
      glowA: 'bg-emerald-300/40',
      glowB: 'bg-teal-300/30',
      header: 'bg-gradient-to-r from-emerald-50/90 via-white/80 to-teal-50/90 border-b border-emerald-100',
      eyebrow: 'bg-emerald-100 text-emerald-800 ring-1 ring-emerald-200',
      iconTile: 'bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-lg shadow-teal-600/25',
      primaryButton: 'bg-teal-700 text-white hover:bg-teal-800 focus-visible:outline-teal-700',
      secondaryButton: 'bg-white/80 text-teal-800 ring-1 ring-teal-200 hover:bg-white focus-visible:outline-teal-700',
    },
  },
  mandi: {
    id: 'mandi',
    title: 'Live Mandi Rates',
    eyebrow: 'Updated through the day',
    description:
      'Today’s rates from Sopore, Shopian, Pampore and the boards that matter — so you know the price before you load the truck.',
    href: '/mandi',
    icon: TrendingUpIcon,
    theme: {
      canvas: 'bg-gradient-to-br from-amber-50 via-orange-50 to-yellow-50',
      glowA: 'bg-amber-300/40',
      glowB: 'bg-orange-200/50',
      header: 'bg-gradient-to-r from-amber-50/90 via-white/80 to-orange-50/90 border-b border-amber-100',
      eyebrow: 'bg-amber-100 text-amber-900 ring-1 ring-amber-200',
      iconTile: 'bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-lg shadow-orange-500/25',
      primaryButton: 'bg-amber-400 text-amber-950 hover:bg-amber-300 focus-visible:outline-amber-600',
      secondaryButton: 'bg-white/80 text-amber-900 ring-1 ring-amber-200 hover:bg-white focus-visible:outline-amber-600',
    },
  },
  priceComparison: {
    id: 'priceComparison',
    title: 'Price Comparison Engine',
    eyebrow: 'Buyers compare, sellers list',
    description:
      'Compare verified offers across growers and traders side by side, or list your own products to reach buyers across India.',
    href: '/price-comparison',
    icon: ScaleIcon,
    theme: {
      canvas: 'bg-gradient-to-br from-sky-50 via-white to-indigo-50',
      glowA: 'bg-sky-300/40',
      glowB: 'bg-indigo-200/40',
      // The fix for the old dark-blue header: a soft light gradient that keeps
      // slate-900 text (≈17:1) and the "List your products" button legible.
      header: 'bg-gradient-to-r from-sky-50/90 via-white/80 to-amber-50/90 border-b border-sky-100',
      eyebrow: 'bg-sky-100 text-sky-800 ring-1 ring-sky-200',
      iconTile: 'bg-gradient-to-br from-sky-400 to-indigo-500 text-white shadow-lg shadow-indigo-500/25',
      primaryButton: 'bg-sky-700 text-white hover:bg-sky-800 focus-visible:outline-sky-700',
      secondaryButton: 'bg-white/80 text-sky-800 ring-1 ring-sky-200 hover:bg-white focus-visible:outline-sky-700',
    },
  },
};

/** Card order on the landing page. */
export const PORTAL_ORDER: readonly PortalId[] = ['escrow', 'mandi', 'priceComparison'];
