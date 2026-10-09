/**
 * PortalShell — the bright glass frame for the three inner portals (Escrow,
 * Mandi, Price Comparison), replacing their old black/dark backgrounds.
 *
 * Each portal gets its own palette from lib/portals.ts: a soft gradient canvas,
 * two blurred colour fields for depth, and a light frosted header. Content
 * placed inside should use GLASS.card surfaces with slate-900/slate-600 text.
 *
 * Wire it once per portal in a route layout (see app/escrow/layout.tsx) and
 * every page under that route picks up the theme.
 */
import type { ReactNode } from 'react';

import { PORTALS, type PortalId } from '@/lib/portals';

interface PortalShellProps {
  portal: PortalId;
  /** Replaces the default header; pass `null` for none. */
  header?: ReactNode;
  children: ReactNode;
}

export function PortalShell({ portal, header, children }: PortalShellProps) {
  const { theme } = PORTALS[portal];
  return (
    <div className={`relative isolate min-h-screen overflow-hidden text-slate-900 ${theme.canvas}`}>
      <div
        aria-hidden
        className={`pointer-events-none absolute -left-32 -top-32 -z-10 h-[28rem] w-[28rem] rounded-full blur-3xl ${theme.glowA}`}
      />
      <div
        aria-hidden
        className={`pointer-events-none absolute -right-24 top-1/3 -z-10 h-[24rem] w-[24rem] rounded-full blur-3xl ${theme.glowB}`}
      />

      {header === undefined ? <PortalHeader portal={portal} /> : header}

      <main className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">{children}</main>
    </div>
  );
}

interface PortalHeaderProps {
  portal: PortalId;
  title?: string;
  description?: string;
  /** Buttons on the right — e.g. the "List your products" CTA. */
  actions?: ReactNode;
}

/** Light frosted header: slate-900 title on a *-50 → white gradient. */
export function PortalHeader({ portal, title, description, actions }: PortalHeaderProps) {
  const { theme, eyebrow, icon: Icon, title: portalTitle } = PORTALS[portal];
  return (
    <header className={`sticky top-0 z-30 backdrop-blur-xl ${theme.header}`}>
      <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6 lg:px-8">
        <div className="flex items-center gap-4">
          <span className={`grid h-12 w-12 shrink-0 place-items-center rounded-2xl ${theme.iconTile}`}>
            <Icon className="h-6 w-6" />
          </span>
          <div className="min-w-0">
            <p className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${theme.eyebrow}`}>{eyebrow}</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight text-slate-900">{title ?? portalTitle}</h1>
            {description && <p className="mt-0.5 text-sm text-slate-600">{description}</p>}
          </div>
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  );
}
