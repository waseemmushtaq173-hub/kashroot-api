/**
 * Seeded pseudo-randomness, shared by every part of the API that has to
 * generate something stable rather than merely something plausible.
 *
 * The property these two functions exist to provide is *reproducibility*: the
 * same seed yields the same stream in every process, on every machine, on every
 * run. That is what separates a simulation from a mock. A `Math.random()`
 * implementation looks right until you refresh the page, at which point every
 * figure jumps and the whole thing reads as fabricated — which it is. Seeded,
 * the numbers hold still the way real ones do.
 *
 * Both are deliberately not cryptographic. Nothing here guards anything; it
 * only has to be spread evenly and cost nothing.
 */

/**
 * FNV-1a, 32-bit.
 *
 * Chosen over a `djb2`-style hash because it mixes the *last* characters as
 * thoroughly as the first. Plate numbers and hub ids differ mostly in their
 * tails (`…1234` vs `…1243`), and a hash that ignores that would hand two
 * different trucks the same identity.
 */
export function hashString(input: string): number {
  let hash = 2166136261;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/**
 * mulberry32 — a small, fast, well-distributed 32-bit PRNG.
 *
 * Returns a function rather than a single value, so one seed can be drawn from
 * repeatedly without the caller tracking an index. Same seed, same stream,
 * every time.
 */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Pick one entry from a list using a seeded stream.
 *
 * Every caller wants the same thing — an index that is stable for a given seed
 * but spread across the list — and each one getting it right on its own is how
 * an off-by-one or a stray `Math.round` creeps in.
 */
export function pickSeeded<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length) % items.length];
}

/**
 * A whole number in [min, max], from a seeded stream.
 *
 * `Math.round` on a scaled float is the obvious spelling and is subtly biased
 * toward the endpoints, which shows up as the same value winning far more often
 * than it should once a list is small.
 */
export function intSeeded(rand: () => number, min: number, max: number): number {
  return min + Math.floor(rand() * (max - min + 1));
}

/** A float in [min, max], from a seeded stream. */
export function floatSeeded(rand: () => number, min: number, max: number): number {
  return min + rand() * (max - min);
}
