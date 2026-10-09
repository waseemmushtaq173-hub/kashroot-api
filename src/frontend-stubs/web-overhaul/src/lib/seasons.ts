/**
 * The photographs the landing-page hero cycles through, each tagged with its
 * season. The badge shows only the season ("spring", "winter") — the pictures
 * speak for the place themselves.
 *
 * Kept out of HeroShowcase (a client component) so the server-rendered page can
 * call `seasonForDate` to open on the real season: a function exported from a
 * 'use client' module becomes a client reference and cannot be called on the
 * server.
 *
 * Images are served from /public/seasons. Several seasons may have more than one
 * photograph; slides play in this order.
 */

export type SeasonId = 'spring' | 'summer' | 'autumn' | 'winter';

export interface SeasonSlide {
  /** Unique per slide — two slides can share a season. */
  key: string;
  season: SeasonId;
  /** Public path of the full-bleed photograph. */
  image: string;
  /**
   * CSS object-position: which part of the photo survives when the screen's
   * shape crops it (a portrait photo on a wide monitor keeps only a band).
   */
  focus: string;
}

export const SEASON_SLIDES: readonly SeasonSlide[] = [
  { key: 'spring-meadow', season: 'spring', image: '/seasons/spring-meadow.jpg', focus: '50% 30%' },
  { key: 'summer-lake', season: 'summer', image: '/seasons/summer-lake.jpg', focus: '50% 50%' },
  { key: 'autumn-garden', season: 'autumn', image: '/seasons/autumn-garden.jpg', focus: '50% 55%' },
  { key: 'winter-road', season: 'winter', image: '/seasons/winter-road.jpg', focus: '50% 15%' },
  { key: 'winter-lake', season: 'winter', image: '/seasons/winter-lake.jpg', focus: '50% 40%' },
];

/** Badge dot per season; full literal classes so Tailwind keeps them. */
export const SEASON_DOT: Record<SeasonId, string> = {
  spring: 'bg-lime-500',
  summer: 'bg-amber-400',
  autumn: 'bg-orange-600',
  winter: 'bg-sky-400',
};

/**
 * The season on `date`, read in India Standard Time so the server's own
 * timezone cannot shift a month boundary.
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
