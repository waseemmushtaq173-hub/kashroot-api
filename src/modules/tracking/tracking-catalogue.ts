import type { TrackingPlace } from './tracking.types';

/**
 * Reference data for the tracking generator.
 *
 * This sits on the server so the origin, the destination and the drawn route
 * are all chosen from one list, and so the places a truck can be sent to are
 * real trading centres rather than strings assembled at random. A tracking page
 * that routed a lorry to "Mandi 4" would give itself away instantly.
 *
 * Coordinates are town-centre approximations, accurate to a few kilometres.
 * That is well inside the tolerance of a route drawn on a slippy map at
 * province scale, and the alternative — surveying each mandi gate — would be
 * false precision on a path that is itself generated.
 */

/**
 * Pickup points: the orchard belts and collection centres produce actually
 * leaves from.
 */
export const TRACKING_ORIGINS: readonly TrackingPlace[] = [
  { name: 'Sopore Fruit Collection Centre', district: 'Baramulla', state: 'Jammu & Kashmir', lat: 34.2986, lng: 74.4711 },
  { name: 'Shopian Orchard Belt', district: 'Shopian', state: 'Jammu & Kashmir', lat: 33.716, lng: 74.834 },
  { name: 'Kulgam Growers Cooperative', district: 'Kulgam', state: 'Jammu & Kashmir', lat: 33.6444, lng: 75.0191 },
  { name: 'Anantnag Fruit Terminal', district: 'Anantnag', state: 'Jammu & Kashmir', lat: 33.7311, lng: 75.1487 },
  { name: 'Pulwama Packing House', district: 'Pulwama', state: 'Jammu & Kashmir', lat: 33.8748, lng: 74.8996 },
  { name: 'Kupwara Walnut Aggregation Point', district: 'Kupwara', state: 'Jammu & Kashmir', lat: 34.5262, lng: 74.2545 },
  { name: 'Bandipora Growers Yard', district: 'Bandipora', state: 'Jammu & Kashmir', lat: 34.4187, lng: 74.6431 },
  { name: 'Ganderbal Collection Yard', district: 'Ganderbal', state: 'Jammu & Kashmir', lat: 34.2298, lng: 74.7778 },
  { name: 'Budgam Orchard Cluster', district: 'Budgam', state: 'Jammu & Kashmir', lat: 34.0159, lng: 74.7198 },
  { name: 'Baramulla Fruit Depot', district: 'Baramulla', state: 'Jammu & Kashmir', lat: 34.198, lng: 74.3636 },
];

/**
 * Delivery points: wholesale mandis that actually take Kashmiri horticulture.
 *
 * Weighted by repetition rather than by a weight column — the three Kashmiri
 * mandis appear twice because most consignments from these collection centres
 * genuinely do terminate inside the valley, and a generator that sent every
 * lorry to Delhi would misrepresent the trade it is depicting.
 */
export const TRACKING_DESTINATIONS: readonly TrackingPlace[] = [
  { name: 'Parimpora Fruit Mandi', district: 'Srinagar', state: 'Jammu & Kashmir', lat: 34.1108, lng: 74.7725 },
  { name: 'Parimpora Fruit Mandi', district: 'Srinagar', state: 'Jammu & Kashmir', lat: 34.1108, lng: 74.7725 },
  { name: 'Sopore Fruit Mandi', district: 'Baramulla', state: 'Jammu & Kashmir', lat: 34.3, lng: 74.465 },
  { name: 'Sopore Fruit Mandi', district: 'Baramulla', state: 'Jammu & Kashmir', lat: 34.3, lng: 74.465 },
  { name: 'Narwal Fruit Mandi', district: 'Jammu', state: 'Jammu & Kashmir', lat: 32.708, lng: 74.854 },
  { name: 'Azadpur Mandi', district: 'North Delhi', state: 'Delhi', lat: 28.712, lng: 77.176 },
  { name: 'Azadpur Mandi', district: 'North Delhi', state: 'Delhi', lat: 28.712, lng: 77.176 },
  { name: 'Jaipur Muhana Mandi', district: 'Jaipur', state: 'Rajasthan', lat: 26.81, lng: 75.79 },
  { name: 'Ludhiana APMC', district: 'Ludhiana', state: 'Punjab', lat: 30.901, lng: 75.8573 },
  { name: 'Amritsar Mewa Mandi', district: 'Amritsar', state: 'Punjab', lat: 31.634, lng: 74.8723 },
  { name: 'Nashik APMC', district: 'Nashik', state: 'Maharashtra', lat: 19.9975, lng: 73.7898 },
  { name: 'Yeshwanthpur APMC', district: 'Bengaluru', state: 'Karnataka', lat: 13.023, lng: 77.554 },
];

/** Vehicle classes a horticulture consignment actually moves in. */
export const TRACKING_VEHICLES: readonly { type: string; capacityTonnes: number }[] = [
  { type: 'Refrigerated light truck', capacityTonnes: 3.5 },
  { type: 'Insulated mini-truck', capacityTonnes: 5 },
  { type: 'Open-body medium truck', capacityTonnes: 7.5 },
  { type: 'Container truck (20 ft)', capacityTonnes: 16 },
  { type: 'Multi-axle haulage truck', capacityTonnes: 21 },
];

/** Commodities these routes carry. */
export const TRACKING_COMMODITIES: readonly { name: string; unit: string; perTonne: number }[] = [
  { name: 'Apple', unit: 'box', perTonne: 90 },
  { name: 'Walnut', unit: 'bag', perTonne: 40 },
  { name: 'Cherry', unit: 'crate', perTonne: 120 },
  { name: 'Pear', unit: 'box', perTonne: 85 },
  { name: 'Saffron', unit: 'tin', perTonne: 200 },
  { name: 'Honey', unit: 'drum', perTonne: 55 },
];

/**
 * People the generator draws from.
 *
 * These are the commonest names in the valley, which is the point: a generated
 * driver should not read as a specific individual, and with no real contact
 * number attached (see below) there is no individual here to identify.
 */
export const TRACKING_DRIVER_NAMES: readonly string[] = [
  'Bilal Ahmad Wani',
  'Javaid Ahmad Dar',
  'Mushtaq Ahmad Bhat',
  'Showkat Ahmad Mir',
  'Fayaz Ahmad Lone',
  'Nazir Ahmad Sheikh',
  'Riyaz Ahmad Ganaie',
  'Tanveer Ahmad Rather',
];

export const TRACKING_OWNER_NAMES: readonly string[] = [
  'Ghulam Nabi Wani',
  'Mohammad Yousuf Dar',
  'Abdul Rashid Bhat',
  'Ali Mohammad Mir',
  'Bashir Ahmad Lone',
  'Farooq Ahmad Sheikh',
  'Manzoor Ahmad Ganaie',
  'Sonaullah Rather',
];

/**
 * The leading digit of every generated contact number.
 *
 * Indian mobile numbers begin 6, 7, 8 or 9. Nothing beginning with 5 is a
 * routable mobile number, so a generated contact cannot ring a real person even
 * if someone taps it, copies it into a dialler, or scrapes the endpoint and
 * cold-calls the list.
 *
 * This is the single most important line in this file. The alternative — a
 * plausible-looking number like `+91 98765 43210` — is a number that belongs to
 * somebody, and a tracking screen is exactly where a reader trusts it enough to
 * dial. A number that cannot connect is worth more than one that merely says,
 * in small print, that it is not real.
 */
export const SIMULATED_CONTACT_PREFIX = '5';

/** The nine digits after the prefix that complete a generated contact. */
export const SIMULATED_CONTACT_DIGITS = 9;

/**
 * Indian registration plates.
 *
 * Two letters of state code, one or two digits of district, one to three
 * letters of series, three or four digits of number — with separators optional,
 * because the same plate is written `JK-05-AB-1234`, `JK05AB1234` and `JK 05 AB
 * 1234` depending on who is typing it. The trailing group is allowed three
 * digits for older registrations still on the road.
 *
 * The second alternative exists for Delhi's commercial series, where the RTO
 * code itself carries a class letter — `DL-1C-A-1234`, not `DL-1-CA-1234`.
 * Those are real plates on real lorries, and a Delhi-registered truck is
 * exactly what would be hauling to Azadpur. It is written as a separate branch,
 * and requires a separator after the class letter, because folding an optional
 * letter into the single pattern makes the regular expression prefer
 * `JK-05A-B-1234` for `JK05AB1234` — a wrong grouping for the much commoner
 * case, in exchange for the rarer one.
 */
export const REGISTRATION_PATTERN =
  /^(?:[A-Za-z]{2}[\s-]?\d{1,2}[\s-]?[A-Za-z]{1,3}[\s-]?\d{3,4}|[A-Za-z]{2}[\s-]?\d{1,2}[A-Za-z][\s-][A-Za-z]{1,3}[\s-]?\d{3,4})$/;

/** The plain shape, separator-free and upper-cased, for pulling the groups back out. */
const REGISTRATION_GROUPS = /^([A-Z]{2})(\d{1,2})([A-Z]{1,3})(\d{3,4})$/;

/** The class-letter shape, matched against the raw input so its separators still exist. */
const REGISTRATION_GROUPS_WITH_CLASS =
  /^([A-Za-z]{2})[\s-]?(\d{1,2})([A-Za-z])[\s-]([A-Za-z]{1,3})[\s-]?(\d{3,4})$/;

/** Strip the separators a plate may be typed with, and upper-case it. */
export function normaliseRegistration(input: string): string {
  return input.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
}

/**
 * Re-group a plate for display.
 *
 * `rawInput` is optional and only ever used to recover one distinction the
 * normalised string has thrown away: whether the district block carried a class
 * letter (`DL-1C-A-1234`) or the series simply began with a letter
 * (`DL-1-CA-1234`). Both normalise to `DL1CA1234`, and only the input still
 * knows which was meant.
 *
 * Returns the normalised string unchanged if nothing matches. The caller has
 * already validated the plate, so this is presentation and never a gate —
 * failing loudly here would turn a cosmetic concern into a 500.
 */
export function formatRegistration(normalised: string, rawInput?: string): string {
  if (rawInput) {
    const withClass = REGISTRATION_GROUPS_WITH_CLASS.exec(rawInput);
    if (withClass) {
      const [, state, district, classLetter, series, number] = withClass;
      return `${state.toUpperCase()}-${district}${classLetter.toUpperCase()}-${series.toUpperCase()}-${number}`;
    }
  }

  const match = REGISTRATION_GROUPS.exec(normalised);
  if (!match) return normalised;

  const [, state, district, series, number] = match;
  return `${state}-${district}-${series}-${number}`;
}
