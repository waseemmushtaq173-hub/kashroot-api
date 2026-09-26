/**
 * BuyerLayout — B2B e-commerce console. Persistent left sidebar, data-dense
 * content area, desktop-first. Think procurement dashboard: fast scanning,
 * tables, filters, escrow status at a glance.
 */
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthContext';
import { buyerNav } from '../navigation/nav-config';

export function BuyerLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen bg-slate-50 text-slate-800">
      {/* Sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="flex items-center gap-2 border-b border-slate-200 px-6 py-5">
          <span aria-hidden className="text-2xl">🌾</span>
          <span className="text-lg font-bold text-brand-600">Kashroot</span>
          <span className="ml-auto rounded-pill bg-buyer-500/10 px-2 py-0.5 text-xs font-semibold text-buyer-600">
            Buyer
          </span>
        </div>
        <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
          {buyerNav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
            >
              <span aria-hidden className="text-lg">{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <button
          onClick={signOut}
          className="m-3 rounded-md px-3 py-2 text-left text-sm text-slate-500 hover:bg-slate-100"
        >
          Sign out
        </button>
      </aside>

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <input
            type="search"
            placeholder="Search commodities, farmers, orders…"
            className="w-96 max-w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm outline-none focus:border-buyer-500"
          />
          <div className="text-sm text-slate-500">
            {user?.displayName} · <span className="font-medium text-slate-700">{user?.role}</span>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
