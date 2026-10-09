/**
 * Landing page — the seasonal hero with exactly three portal cards.
 *
 * Bright by construction: no dark surfaces anywhere. Content sits on frosted
 * white glass over the HeroShowcase slideshow, so slate-900 text stays legible
 * whatever the photograph underneath.
 *
 * Every portal CTA goes straight to the matching role sign-in
 * (/login/{farmer|buyer|seller}) with `next` set to the portal, so the user
 * lands where they clicked — there is no generic auth page in between.
 *
 * A server component: only HeroShowcase (the timer) ships as client JS.
 */
import Link from 'next/link';

import { HeroShowcase } from '@/components/layout/HeroShowcase';
import { ArrowRightIcon, LeafIcon } from '@/components/ui/icons';
import { loginHref, PORTAL_ROLES, ROLE_LABELS } from '@/lib/auth/roles';
import { GLASS, PORTAL_ORDER, PORTALS, type PortalId } from '@/lib/portals';
import { seasonForDate } from '@/lib/seasons';

// Re-render hourly so the hero opens on the current season, not the build's.
export const revalidate = 3600;

interface PortalAction {
  label: string;
  href: string;
}

/** Primary + secondary CTA per card. Logins carry the portal as `next`. */
const PORTAL_ACTIONS: Record<PortalId, { primary: PortalAction; secondary: PortalAction }> = {
  escrow: {
    primary: { label: 'Buy with escrow', href: loginHref('buyer', PORTALS.escrow.href) },
    secondary: { label: 'Sell with escrow', href: loginHref('seller', PORTALS.escrow.href) },
  },
  mandi: {
    primary: { label: 'Open farmer portal', href: loginHref('farmer', PORTALS.mandi.href) },
    // The mandi board is public (GET /api/v1/mandi needs no token).
    secondary: { label: 'Preview today’s rates', href: PORTALS.mandi.href },
  },
  priceComparison: {
    primary: { label: 'Compare prices', href: loginHref('buyer', PORTALS.priceComparison.href) },
    secondary: { label: 'List your products', href: loginHref('seller', PORTALS.priceComparison.href) },
  },
};

const FOCUS_RING = 'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2';

export default function HomePage() {
  return (
    <HeroShowcase initialSeason={seasonForDate(new Date())}>
      <header className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-4 pt-5 sm:px-6 lg:px-8">
        <Link
          href="/"
          className={`flex items-center gap-2.5 rounded-2xl py-2 pl-2 pr-4 ${GLASS.panel} ${FOCUS_RING} focus-visible:outline-emerald-700`}
        >
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-gradient-to-br from-emerald-500 to-teal-600 text-white shadow-md shadow-emerald-600/30">
            <LeafIcon className="h-5 w-5" />
          </span>
          <span className="text-lg font-semibold tracking-tight text-slate-900">Kashroot</span>
        </Link>

        <nav aria-label="Sign in" className={`hidden items-center gap-1 rounded-2xl p-1.5 sm:flex ${GLASS.panel}`}>
          <span className="px-2 text-xs font-medium text-slate-500">Sign in as</span>
          {PORTAL_ROLES.map((role) => (
            <Link
              key={role}
              href={loginHref(role)}
              className={`rounded-xl px-3 py-1.5 text-sm font-medium text-slate-700 transition hover:bg-white hover:text-slate-900 ${FOCUS_RING} focus-visible:outline-slate-700`}
            >
              {ROLE_LABELS[role]}
            </Link>
          ))}
        </nav>
      </header>

      {/* Bottom padding leaves room for the season badge, which is sized to
          land on the first screen at common desktop heights (900px+). */}
      <main className="mx-auto max-w-7xl px-4 pb-32 pt-8 sm:px-6 sm:pt-12 lg:px-8">
        <section className={`max-w-2xl rounded-[2rem] p-6 sm:p-9 ${GLASS.panel}`}>
          <p className="inline-flex rounded-full bg-white/80 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-800 ring-1 ring-emerald-200">
            The agri-business ecosystem
          </p>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-slate-900 [text-wrap:balance] sm:text-5xl lg:text-6xl">
            Every harvest,{' '}
            <span className="bg-gradient-to-r from-emerald-700 to-teal-700 bg-clip-text text-transparent">
              traded with trust.
            </span>
          </h1>
          <p className="mt-4 max-w-xl text-base leading-relaxed text-slate-700 sm:text-lg">
            Escrow-protected payments, live mandi rates and transparent price comparison for growers, traders
            and buyers.
          </p>
        </section>

        <section aria-label="Kashroot portals" className="mt-6 grid gap-5 sm:mt-8 md:grid-cols-3">
          {PORTAL_ORDER.map((id) => (
            <PortalCard key={id} id={id} />
          ))}
        </section>
      </main>
    </HeroShowcase>
  );
}

function PortalCard({ id }: { id: PortalId }) {
  const portal = PORTALS[id];
  const { theme } = portal;
  const { primary, secondary } = PORTAL_ACTIONS[id];
  const Icon = portal.icon;

  return (
    <article
      className={`group relative flex flex-col overflow-hidden rounded-3xl p-6 ${GLASS.panel} transition duration-300 hover:-translate-y-1 hover:bg-white/80 hover:shadow-[0_24px_60px_rgba(15,23,42,0.18)] motion-reduce:transition-none motion-reduce:hover:translate-y-0`}
    >
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-12 -top-12 h-40 w-40 rounded-full opacity-50 blur-3xl transition-opacity duration-300 group-hover:opacity-100 ${theme.glowA}`}
      />

      <div className="relative flex items-start justify-between gap-3">
        <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${theme.iconTile}`}>
          <Icon className="h-6 w-6" />
        </span>
        <span className={`rounded-full px-3 py-1 text-xs font-semibold ${theme.eyebrow}`}>{portal.eyebrow}</span>
      </div>

      <h2 className="relative mt-5 text-xl font-semibold tracking-tight text-slate-900">{portal.title}</h2>
      <p className="relative mt-2 text-sm leading-relaxed text-slate-600">{portal.description}</p>

      <div className="relative mt-auto flex flex-wrap gap-2 pt-6">
        <Link
          href={primary.href}
          className={`inline-flex items-center gap-1.5 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-sm transition ${FOCUS_RING} ${theme.primaryButton}`}
        >
          {primary.label}
          <ArrowRightIcon className="h-4 w-4 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" />
        </Link>
        <Link
          href={secondary.href}
          className={`inline-flex items-center rounded-xl px-4 py-2.5 text-sm font-semibold transition ${FOCUS_RING} ${theme.secondaryButton}`}
        >
          {secondary.label}
        </Link>
      </div>
    </article>
  );
}
