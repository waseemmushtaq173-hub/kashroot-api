import { haversineKm } from '../../common/utils/geo';
import type { MandiCommodity, MandiHub } from './mandi-live.types';

/**
 * Static reference data for the live mandi feed: the hubs a request can resolve
 * to, and the commodities it can be asked for.
 *
 * This lives on the server rather than in the web client so both the location
 * selector and the coordinate lookup are driven by one list, and so the
 * `coverage` flag below cannot drift out of sync with what the API actually
 * knows how to fetch.
 *
 * Every hub is `coverage: 'live'`: each attempts to fetch from the configured
 * Agmarknet upstream. When the upstream carries no published rows for a state,
 * the board is returned empty with an honest message — no generated prices are
 * ever substituted.
 */

export const MANDI_HUBS: readonly MandiHub[] = [
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
  {
    id: 'jammu-kashmir',
    label: 'Jammu & Kashmir — Srinagar',
    state: 'Jammu & Kashmir',
    upstreamState: 'Jammu & Kashmir',
    lat: 34.0837,
    lng: 74.7973,
    coverage: 'live',
    markets: ['Parimpora Fruit Mandi', 'Sopore Fruit Mandi', 'Narwal Mandi'],
  },
  {
    id: 'delhi',
    label: 'Delhi — Azadpur',
    state: 'Delhi',
    upstreamState: 'Delhi',
    lat: 28.7041,
    lng: 77.1025,
    coverage: 'live',
    markets: ['Azadpur Mandi'],
  },
  {
    id: 'rajasthan',
    label: 'Rajasthan — Jaipur',
    state: 'Rajasthan',
    upstreamState: 'Rajasthan',
    lat: 26.9124,
    lng: 75.7873,
    coverage: 'live',
    markets: ['Jaipur Muhana Mandi'],
  },
  {
    id: 'himachal-pradesh',
    label: 'Himachal Pradesh — Shimla',
    state: 'Himachal Pradesh',
    upstreamState: 'Himachal Pradesh',
    lat: 31.1048,
    lng: 77.1734,
    coverage: 'live',
    markets: ['Shimla Dhalli Mandi'],
  },
  {
    id: 'haryana',
    label: 'Haryana — Karnal',
    state: 'Haryana',
    upstreamState: 'Haryana',
    lat: 29.6857,
    lng: 76.9905,
    coverage: 'live',
    markets: ['Karnal APMC'],
  },
  {
    id: 'gujarat',
    label: 'Gujarat — Ahmedabad',
    state: 'Gujarat',
    upstreamState: 'Gujarat',
    lat: 23.0225,
    lng: 72.5714,
    coverage: 'live',
    markets: ['Ahmedabad Jamalpur Mandi'],
  },
  {
    id: 'uttarakhand',
    label: 'Uttarakhand — Dehradun',
    state: 'Uttarakhand',
    upstreamState: 'Uttarakhand',
    lat: 30.3165,
    lng: 78.0322,
    coverage: 'live',
    markets: ['Dehradun Mandi'],
  },
];

/**
 * Commodities the feed accepts.
 *
 * These are the crop names the upstream Agmarknet feed indexes by. No anchor
 * prices or volatility figures are stored here — prices come exclusively from
 * live upstream records or from verified reporter submissions.
 */
export const MANDI_COMMODITIES: readonly MandiCommodity[] = [
  { name: 'Apple', unit: 'quintal' },
  { name: 'Walnut', unit: 'quintal' },
  { name: 'Saffron', unit: 'kg' },
  { name: 'Cherry', unit: 'quintal' },
  { name: 'Pear', unit: 'quintal' },
  { name: 'Honey', unit: 'kg' },
  { name: 'Onion', unit: 'quintal' },
  { name: 'Potato', unit: 'quintal' },
  { name: 'Tomato', unit: 'quintal' },
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
