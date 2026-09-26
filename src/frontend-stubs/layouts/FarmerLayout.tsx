/**
 * FarmerLayout — mobile-first, extreme-accessibility shell.
 *   - Massive bottom navigation (thumb-reachable, icon + label, huge targets).
 *   - A floating Voice Assistant button anchored bottom-centre, always visible:
 *     the primary way a low-literacy farmer operates the whole app.
 *   - Generous type scale; colour + icon carry meaning, text is secondary.
 *
 * Web (Tailwind) reference. On React Native this becomes a Tab.Navigator with a
 * custom tabBar and an absolutely-positioned FAB; the structure is identical.
 */
import type { ReactNode } from 'react';

import { farmerNav } from '../navigation/nav-config';
import { VoiceAssistantButton } from '../VoiceAssistantButton';

export function FarmerLayout({ children }: { children: ReactNode }) {
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col bg-brand-50 text-[20px]">
      {/* Simple, high-contrast header — village name / greeting could live here. */}
      <header className="sticky top-0 z-10 bg-brand-500 px-4 py-4 text-white shadow-card">
        <h1 className="text-2xl font-extrabold">Kashroot</h1>
      </header>

      {/* Route content. Bottom padding leaves room for the nav + FAB. */}
      <main className="flex-1 overflow-y-auto px-4 pb-40 pt-4">{children}</main>

      {/* Floating Voice Assistant — the hero control, above the nav bar. */}
      <div className="pointer-events-none fixed inset-x-0 bottom-24 z-20 flex justify-center">
        <div className="pointer-events-auto scale-75 drop-shadow-float">
          <VoiceAssistantButton />
        </div>
      </div>

      {/* Bottom navigation — 4 giant targets. */}
      <nav className="fixed inset-x-0 bottom-0 z-10 mx-auto flex max-w-md justify-around border-t border-brand-100 bg-white py-2">
        {farmerNav.map((item) => (
          <a
            key={item.href}
            href={item.href}
            className="flex min-w-16 flex-col items-center gap-1 rounded-md px-3 py-2 text-brand-700 active:bg-brand-50"
          >
            <span aria-hidden className="text-3xl">
              {item.icon}
            </span>
            <span className="text-sm font-semibold">{item.label}</span>
          </a>
        ))}
      </nav>
    </div>
  );
}
