/**
 * TesterLayout — the AgroGuard testing suite shell. A dark, instrument-style
 * chrome that frames the counterfeit-detection station: a camera HUD strip up
 * top, the batch inspector / rapid agency-audit toolbar, and the live station
 * in <main>. Distinct from every other persona — this is a field QC tool, not a
 * consumer surface. All UI text stays English (see the spoken-audio spec).
 */
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthContext';
import { testerNav } from '../navigation/nav-config';

export function TesterLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-900 text-slate-100">
      {/* Camera HUD strip */}
      <header className="border-b border-slate-700 bg-slate-950">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-3">
          <span className="flex items-center gap-2 text-lg font-bold text-emerald-400">
            <span aria-hidden>🔬</span> AgroGuard
          </span>
          <span className="rounded-pill bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-300">
            Tester
          </span>
          <span className="ml-2 flex items-center gap-1.5 text-xs text-slate-400">
            <span aria-hidden className="inline-block h-2 w-2 animate-kr-pulse rounded-full bg-red-500" />
            Camera live
          </span>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-400">
            <span>{user?.displayName}</span>
            <button onClick={signOut} className="text-slate-500 hover:text-slate-200">
              Sign out
            </button>
          </div>
        </div>

        {/* Rapid agency-audit toolbar */}
        <nav className="mx-auto flex max-w-5xl gap-1 px-6 pb-2">
          {testerNav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-slate-300 hover:bg-slate-800 hover:text-white"
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
