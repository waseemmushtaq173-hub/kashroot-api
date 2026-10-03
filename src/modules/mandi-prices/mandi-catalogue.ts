import type { MandiCommodity, MandiHub } from './mandi-live.types';

/**
 * Static reference data for the live mandi feed: the hubs a request can resolve
 * to, and the commodities it can be asked for.
 *
 * This lives on the server rather than in the web client so both the location
 * selector and the coordinate lookup are driven by one list, and so the
 * `coverage` flag below cannot drift out of sync with what the API actually
 * knows how to fetch.
 */

/**
 * The market hubs the feed can resolve to.
 *
 * `coverage` is the important column. 'live' means an upstream Agmarknet feed
 * publishes daily board prices for that state; 'modelled' means nothing
 * upstream covers it and the simulated provider answers instead. Seven of these
 * hubs are 'modelled' today — including Srinagar, Azadpur and Jaipur, the three
 * boards this product cares about most — because the public feed carries only
 * five states and none of them are those. Recording that here rather than
 * guessing at runtime is what stops a generated series being served under a
 * live label.
 *
 * Coordinates are city/trading-centre approximations. They only ever need to be
 * accurate enough to pick the right state from a browser fix, so a few
 * kilometres of drift is harmless.
 */
export const MANDI_HUBS: readonly MandiHub[] = [
  // ── Hubs with real upstream coverage ─────────────────────────────────────
  {
    id: 'punjab',
    label: 'Punjab — Ludhiana & Amritsar',
    state: 'Punjab',
    upstreamState: 'Punjab',
    lat: 30.901,
    lng: 75.8573,
    coverage: 'live',
    markets: ['Ludhiana APMC', 'Amritsar Mewa Mandi'],
  },
  {
    id: 'maharashtra',
    label: 'Maharashtra — Nashik & Pune',
    state: 'Maharashtra',
    upstreamState: 'Maharashtra',
    lat: 19.9975,
    lng: 73.7898,
    coverage: 'live',
    markets: ['Nashik APMC', 'Pune Market Yard'],
  },
  {
    id: 'uttar-pradesh',
    label: 'Uttar Pradesh — Lucknow & Agra',
    state: 'Uttar Pradesh',
    upstreamState: 'Uttar Pradesh',
    lat: 26.8467,
    lng: 80.9462,
    coverage: 'live',
    markets: ['Lucknow APMC', 'Agra Mandi'],
  },
  {
    id: 'madhya-pradesh',
    label: 'Madhya Pradesh — Indore',
    state: 'Madhya Pradesh',
    upstreamState: 'Madhya Pradesh',
    lat: 22.7196,
    lng: 75.8577,
    coverage: 'live',
    markets: ['Indore Choithram Mandi'],
  },
  {
    id: 'karnataka',
    label: 'Karnataka — Bengaluru',
    state: 'Karnataka',
    upstreamState: 'Karnataka',
    lat: 12.9716,
    lng: 77.5946,
    coverage: 'live',
    markets: ['Yeshwanthpur APMC', 'Binny Mill Yard'],
  },

  // ── Hubs with no upstream coverage ───────────────────────────────────────
  {
    id: 'jammu-kashmir',
    label: 'Jammu & Kashmir — Srinagar',
    state: 'Jammu & Kashmir',
    upstreamState: null,
    lat: 34.0837,
    lng: 74.7973,
    coverage: 'modelled',
    markets: ['Parimpora Fruit Mandi', 'Sopore Fruit Mandi', 'Narwal Mandi'],
  },
  {
    id: 'delhi',
    label: 'Delhi — Azadpur',
    state: 'Delhi',
    upstreamState: null,
    lat: 28.7041,
    lng: 77.1025,
    coverage: 'modelled',
    markets: ['Azadpur Mandi'],
  },
  {
    id: 'rajasthan',
    label: 'Rajasthan — Jaipur',
    state: 'Rajasthan',
    upstreamState: null,
    lat: 26.9124,
    lng: 75.7873,
    coverage: 'modelled',
    markets: ['Jaipur Muhana Mandi'],
  },
  {
    id: 'himachal-pradesh',
    label: 'Himachal Pradesh — Shimla',
    state: 'Himachal Pradesh',
    upstreamState: null,
    lat: 31.1048,
    lng: 77.1734,
    coverage: 'modelled',
    markets: ['Shimla Dhalli Mandi'],
  },
  {
    id: 'haryana',
    label: 'Haryana — Karnal',
    state: 'Haryana',
    upstreamState: null,
    lat: 29.6857,
    lng: 76.9905,
    coverage: 'modelled',
    markets: ['Karnal APMC'],
  },
  {
    id: 'gujarat',
    label: 'Gujarat — Ahmedabad',
    state: 'Gujarat',
    upstreamState: null,
    lat: 23.0225,
    lng: 72.5714,
    coverage: 'modelled',
    markets: ['Ahmedabad Jamalpur Mandi'],
  },
  {
    id: 'uttarakhand',
    label: 'Uttarakhand — Dehradun',
    state: 'Uttarakhand',
    upstreamState: null,
    lat: 30.3165,
    lng: 78.0322,
    coverage: 'modelled',
    markets: ['Dehradun Mandi'],
  },
];

/**
 * Commodities the feed accepts, with the anchor the simulated provider centres
 * its series on.
 *
 * The anchors are illustrative wholesale levels in rupees, chosen to sit in the
 * right order of magnitude so a demo reads plausibly; they are not harvested
 * from anywhere. They are only ever consulted for hubs with `modelled`
 * coverage — a live hub's prices come from the upstream feed in full.
 */
export const MANDI_COMMODITIES: readonly MandiCommodity[] = [
  { name: 'Apple', unit: 'quintal', basePrice: 5500, volatility: 0.18 },
  { name: 'Walnut', unit: 'quintal', basePrice: 14000, volatility: 0.15 },
  { name: 'Saffron', unit: 'kg', basePrice: 265000, volatility: 0.1 },
  { name: 'Cherry', unit: 'quintal', basePrice: 9000, volatility: 0.2 },
  { name: 'Pear', unit: 'quintal', basePrice: 4200, volatility: 0.16 },
  { name: 'Honey', unit: 'kg', basePrice: 420, volatility: 0.12 },
  { name: 'Onion', unit: 'quintal', basePrice: 1800, volatility: 0.25 },
  { name: 'Potato', unit: 'quintal', basePrice: 1350, volatility: 0.2 },
  { name: 'Tomato', unit: 'quintal', basePrice: 2300, volatility: 0.3 },
];

/** The commodity served when a request names none. */
export const DEFAULT_COMMODITY = 'Apple';

/** Look a hub up by its id. Case-insensitive; returns null when unknown. */
export function findHub(id: string): MandiHub | null {
  const wanted = id.trim().toLowerCase();
  return MANDI_HUBS.find((hub) => hub.id === wanted) ?? null;
}

/** Look a commodity up by name. Case-insensitive; returns null when unknown. */
export function findCommodity(name: string): MandiCommodity | null {
  const wanted = name.trim().toLowerCase();
  return MANDI_COMMODITIES.find((c) => c.name.toLowerCase() === wanted) ?? null;
}

/**
 * The hub closest to a browser fix, with its distance.
 *
 * Straight-line distance is fine here: the hubs are hundreds of kilometres
 * apart, so the nearest one is unambiguously the right state even with a few
 * kilometres of error in the coordinates.
 */
export function nearestHub(
  lat: number,
  lng: number,
): { hub: MandiHub; distanceKm: number } {
  let best: { hub: MandiHub; distanceKm: number } | null = null;

  for (const hub of MANDI_HUBS) {
    const distanceKm = haversineKm(lat, lng, hub.lat, hub.lng);
    if (!best || distanceKm < best.distanceKm) best = { hub, distanceKm };
  }

  // MANDI_HUBS is a non-empty literal above, so this is unreachable; it exists
  // to keep the return type non-nullable without a non-null assertion.
  if (!best) throw new Error('MANDI_HUBS is empty');
  return best;
}

/** Great-circle distance in kilometres between two coordinates. */
function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const EARTH_RADIUS_KM = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}
