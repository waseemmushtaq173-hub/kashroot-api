/**
 * AdminLayout — institutional back-office. Dark slate sidebar, dense neutral
 * content area built for moderation queues, the immutable ledger, and mandi
 * board administration. No playful colour: trust through restraint.
 */
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthContext';
import { adminNav } from '../navigation/nav-config';

export function AdminLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="flex min-h-screen bg-slate-100 text-slate-800">
      <aside className="flex w-60 shrink-0 flex-col bg-slate-900 text-slate-300">
        <div className="border-b border-slate-800 px-5 py-4">
          <div className="text-sm font-bold tracking-wide text-white">KASHROOT</div>
          <div className="text-xs text-slate-400">Back-office · {user?.role}</div>
        </div>
        <nav className="flex flex-1 flex-col gap-0.5 px-2 py-3">
          {adminNav.map((item) => (
            <a
              key={item.href}
              href={item.href}
              className="flex items-center gap-3 rounded px-3 py-2 text-sm hover:bg-slate-800 hover:text-white"
            >
              <span aria-hidden>{item.icon}</span>
              {item.label}
            </a>
          ))}
        </nav>
        <button
          onClick={signOut}
          className="m-2 rounded px-3 py-2 text-left text-sm text-slate-400 hover:bg-slate-800"
        >
          Sign out
        </button>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between border-b border-slate-200 bg-white px-6 py-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            Administration
          </h2>
          <span className="text-sm text-slate-600">{user?.displayName}</span>
        </header>
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
