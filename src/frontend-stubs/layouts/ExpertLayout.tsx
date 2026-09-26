/**
 * ExpertLayout — clean, professional dashboard for agricultural experts. Calm
 * top navigation, plenty of whitespace, saffron accent to signal the premium
 * advisory tier. Centres on appointments and the expert's own KYC standing.
 */
import type { ReactNode } from 'react';

import { useAuth } from '../auth/AuthContext';
import { expertNav } from '../navigation/nav-config';

export function ExpertLayout({ children }: { children: ReactNode }) {
  const { user, signOut } = useAuth();

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-6 px-6 py-4">
          <span className="text-lg font-bold text-brand-600">Kashroot</span>
          <span className="rounded-pill bg-saffron-100 px-2 py-0.5 text-xs font-semibold text-saffron-600">
            Expert
          </span>
          <nav className="ml-4 flex gap-1">
            {expertNav.map((item) => (
              <a
                key={item.href}
                href={item.href}
                className="rounded-md px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-900"
              >
                {item.label}
              </a>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-3 text-sm text-slate-500">
            <span>{user?.displayName}</span>
            <button onClick={signOut} className="text-slate-400 hover:text-slate-700">
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
