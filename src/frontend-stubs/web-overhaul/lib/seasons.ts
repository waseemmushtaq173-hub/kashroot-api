/**
 * The four Kashmir seasons the landing-page hero cycles through.
 *
 * Kept out of HeroShowcase (a client component) so the server-rendered page can
 * call `seasonForDate` to open on the real season: a function exported from a
 * 'use client' module becomes a client reference and cannot be called on the
 * server.
 *
 * Images are served from /public. Relabel `name`/`place` to match what your
 * photographs actually show.
 */

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export interface Season {
  id: SeasonId;
  /** Public path of the full-bleed background photograph. */
  image: string;
  /** Shown on the glass badge, e.g. "Spring Almond Blossoms". */
  name: string;
  /** Secondary badge line — where/what the photograph is. */
  place: string;
  /** Badge dot colour; a full literal class so Tailwind keeps it. */
  dotClass: string;
}

export const SEASONS: readonly Season[] = [
  {
    id: 'spring',
    image: '/spring.jpeg',
    name: 'Spring Almond Blossoms',
    place: 'Badamwari, Srinagar',
    dotClass: 'bg-pink-400',
  },
  {
    id: 'summer',
    image: '/summer.jpeg',
    name: 'Summer Orchard Canopy',
    place: 'Apple orchards of Shopian',
    dotClass: 'bg-emerald-500',
  },
  {
    id: 'autumn',
    image: '/autumn.jpeg',
    name: 'Autumn Saffron Harvest',
    place: 'Saffron fields of Pampore',
    dotClass: 'bg-orange-500',
  },
  {
    id: 'winter',
    image: '/winter.jpeg',
    name: 'Winter Snow-Clad Valleys',
    place: 'Gulmarg & the Pir Panjal',
    dotClass: 'bg-sky-400',
  },
];

/**
 * The season in Kashmir on `date`, read in India Standard Time so the server's
 * own timezone cannot shift a month boundary.
 * Mar–May spring, Jun–Aug summer, Sep–Nov autumn, Dec–Feb winter.
 */
export function seasonForDate(date: Date): SeasonId {
  const month = Number(
    new Intl.DateTimeFormat('en-IN', { timeZone: 'Asia/Kolkata', month: 'numeric' }).format(date),
  );
  if (month >= 3 && month <= 5) return 'spring';
  if (month >= 6 && month <= 8) return 'summer';
  if (month >= 9 && month <= 11) return 'autumn';
  return 'winter';
}
