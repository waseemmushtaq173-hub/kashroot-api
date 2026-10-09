'use client';

/**
 * HeroShowcase — the full-screen seasonal backdrop for the landing page.
 *
 * Crossfades through the four Kashmir seasons every `intervalMs` (7s) with a
 * slow Ken Burns zoom, under a light scrim that keeps glass content readable on
 * any photograph. A frosted badge (bottom-right) names the season on screen and
 * doubles as the carousel control: season dots with a progress fill, and a
 * pause button — auto-moving content longer than 5s must be pausable (WCAG
 * 2.2.2).
 *
 *   - Crossfade without a "dip": the incoming slide fades in ABOVE the outgoing
 *     one, which stays fully opaque underneath until the next change.
 *   - The timer is keyed to the active slide, so choosing a season by hand
 *     restarts the full interval instead of cutting it short.
 *   - Rotation stops while the tab is hidden, and the zoom only runs for users
 *     who have not asked for reduced motion.
 *
 * The photographs sit on a `fixed` layer: on a phone, where the stacked portal
 * cards make the page taller than the screen, the image stays viewport-sized
 * instead of being cropped to a sliver and upscaled.
 */
import Image from 'next/image';
import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';

import { MapPinIcon, PauseIcon, PlayIcon } from '@/components/ui/icons';
import { SEASONS, type Season, type SeasonId } from '@/lib/seasons';

interface HeroShowcaseProps {
  slides?: readonly Season[];
  intervalMs?: number;
  /** Season to open on — pass `seasonForDate(new Date())` from the server. */
  initialSeason?: SeasonId;
  /** Page content, rendered above the slideshow. */
  children?: ReactNode;
}

export function HeroShowcase({
  slides = SEASONS,
  intervalMs = 7000,
  initialSeason,
  children,
}: HeroShowcaseProps) {
  const [firstIndex] = useState(() => Math.max(0, slides.findIndex((s) => s.id === initialSeason)));
  const [{ active, previous }, setSlides] = useState({ active: firstIndex, previous: firstIndex });
  const [paused, setPaused] = useState(false);
  const pageVisible = useSyncExternalStore(subscribeToVisibility, isPageVisible, () => true);
  const progressRef = useRef<HTMLSpanElement>(null);

  const running = !paused && pageVisible && slides.length > 1;

  const goTo = (index: number) =>
    setSlides((s) => (index === s.active ? s : { active: index, previous: s.active }));

  useEffect(() => {
    if (!running) return;
    const timer = window.setTimeout(
      () => setSlides((s) => ({ active: (s.active + 1) % slides.length, previous: s.active })),
      intervalMs,
    );
    return () => window.clearTimeout(timer);
  }, [active, running, intervalMs, slides.length]);

  // Fill the active dot over the interval. Animates `transform` directly (never
  // a Tailwind scale class) so Tailwind v3's transform and v4's `scale`
  // property cannot fight over the same bar.
  useEffect(() => {
    const bar = progressRef.current;
    if (!bar || !running) return;
    const fill = bar.animate([{ transform: 'scaleX(0)' }, { transform: 'scaleX(1)' }], {
      duration: intervalMs,
      easing: 'linear',
      fill: 'forwards',
    });
    return () => fill.cancel();
  }, [active, running, intervalMs]);

  const current = slides[active];

  return (
    <div className="relative isolate min-h-[100svh]">
      <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden bg-sky-100">
        {slides.map((slide, i) => (
          <div
            key={slide.id}
            className={`absolute inset-0 transition-opacity duration-[1600ms] ease-in-out motion-reduce:transition-none ${
              i === active ? 'z-10 opacity-100' : i === previous ? 'z-0 opacity-100' : 'z-0 opacity-0'
            }`}
          >
            <Image
              src={slide.image}
              alt=""
              fill
              sizes="100vw"
              priority={i === firstIndex}
              className={`object-cover transition-transform duration-[9000ms] ease-out ${
                i === active ? 'motion-safe:scale-110' : 'scale-100'
              }`}
            />
          </div>
        ))}
        {/* Light scrim: brighter at the top (nav) and bottom (cards + badge). */}
        <div className="absolute inset-0 z-20 bg-gradient-to-b from-white/40 via-white/5 to-white/50" />
        <div className="absolute inset-0 z-20 bg-[radial-gradient(ellipse_at_top_left,rgba(255,255,255,0.6),transparent_55%)]" />
      </div>

      {children}

      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-end p-4 sm:p-6">
        <div className="pointer-events-auto flex items-center gap-4 rounded-2xl bg-white/70 py-3 pl-4 pr-3 shadow-[0_8px_30px_rgba(15,23,42,0.12)] ring-1 ring-white/70 backdrop-blur-xl">
          <span aria-hidden className={`h-2.5 w-2.5 shrink-0 rounded-full ring-4 ring-white/80 ${current.dotClass}`} />

          {/* Announce the season only when the user is driving the carousel;
              a polite announcement every 7s would drown out a screen reader. */}
          <div aria-live={paused ? 'polite' : 'off'} className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-500">
              Kashmir in {current.id}
            </p>
            <p className="truncate text-sm font-semibold text-slate-900">{current.name}</p>
            <p className="flex items-center gap-1 truncate text-xs text-slate-600">
              <MapPinIcon className="h-3.5 w-3.5 shrink-0" />
              {current.place}
            </p>
          </div>

          <div className="hidden items-center sm:flex" role="group" aria-label="Choose a season">
            {slides.map((slide, i) => (
              <button
                key={slide.id}
                type="button"
                onClick={() => goTo(i)}
                aria-label={`Show ${slide.name}`}
                aria-current={i === active ? 'true' : undefined}
                className="grid h-7 cursor-pointer place-items-center px-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-700"
              >
                <span
                  className={`relative block h-1.5 overflow-hidden rounded-full transition-all duration-300 ${
                    i === active ? 'w-8 bg-slate-900/10' : 'w-1.5 bg-slate-900/30 hover:bg-slate-900/50'
                  }`}
                >
                  {i === active && (
                    <span
                      ref={progressRef}
                      className="absolute inset-0 origin-left rounded-full bg-slate-800"
                      style={{ transform: running ? 'scaleX(0)' : 'scaleX(1)' }}
                    />
                  )}
                </span>
              </button>
            ))}
          </div>

          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            aria-label={paused ? 'Play season slideshow' : 'Pause season slideshow'}
            className="grid h-8 w-8 shrink-0 cursor-pointer place-items-center rounded-full bg-white/80 text-slate-700 ring-1 ring-slate-900/10 transition hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-slate-700"
          >
            {paused ? <PlayIcon className="h-4 w-4" /> : <PauseIcon className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

function subscribeToVisibility(onChange: () => void): () => void {
  document.addEventListener('visibilitychange', onChange);
  return () => document.removeEventListener('visibilitychange', onChange);
}

function isPageVisible(): boolean {
  return document.visibilityState === 'visible';
}
