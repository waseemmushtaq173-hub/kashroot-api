import { BadRequestException, Injectable } from '@nestjs/common';

import {
  floatSeeded,
  hashString,
  mulberry32,
  pickSeeded,
} from '../../common/utils/deterministic';
import { bearingDeg, haversineKm, lerpPoint } from '../../common/utils/geo';
import {
  formatRegistration,
  normaliseRegistration,
  REGISTRATION_PATTERN,
  SIMULATED_CONTACT_DIGITS,
  SIMULATED_CONTACT_PREFIX,
  TRACKING_COMMODITIES,
  TRACKING_DESTINATIONS,
  TRACKING_DRIVER_NAMES,
  TRACKING_ORIGINS,
  TRACKING_OWNER_NAMES,
  TRACKING_VEHICLES,
} from './tracking-catalogue';
import type {
  LiveVehicleTracking,
  RoutePathPoint,
  ShipmentStatus,
  TrackingEvent,
  TrackingPlace,
  VehiclePosition,
} from './tracking.types';

/** Points drawn between the two endpoints, inclusive of both ends. */
const ROUTE_WAYPOINTS = 32;

/**
 * How far the drawn route may stray from the straight line, as a fraction of
 * the straight-line distance.
 *
 * A lorry does not drive in a straight line, but a route drawn with too much
 * wander stops reading as a road and starts reading as a scribble. Eleven
 * percent is enough to look like a highway on a provincial map without
 * implying the driver is lost.
 */
const MAX_LATERAL_FRACTION = 0.11;

/**
 * Shortest run worth depicting.
 *
 * A collection centre and the mandi in the same town are six hundred metres
 * apart, and drawing a route for that produces a page that looks broken rather
 * than one that looks short. Below this, a different destination is chosen.
 */
const MIN_TRIP_KM = 25;

/** Hours added for loading at the origin and unloading at the mandi. */
const DWELL_HOURS = 1.5;

/** Average highway speed the schedule is built around, in km/h. */
const SCHEDULE_SPEED_KMPH = 38;

/**
 * Bounds on how long a run may be scheduled to take.
 *
 * The floor is well above the pure driving time for a short hop, and that is
 * deliberate. A forty-kilometre run from a collection centre to a valley mandi
 * is an hour of driving, but the lorry is gone for most of a day: it loads for
 * an hour and a half, queues at the gate, waits for a weighbridge slot, and
 * unloads. A six-hour window is the honest figure for the trip, and it is also
 * what keeps the rolling cycle long enough that the wrap back to the origin —
 * the one artefact of this model — is very unlikely to be visible while
 * somebody is watching. At an hour and a quarter the shortest runs wrapped
 * every seventy-five minutes and the lorry visibly jumped.
 *
 * The ceiling keeps the implied average speed of even the longest run inside
 * what a loaded lorry can actually do. Srinagar to Bengaluru is a sixty-five
 * hour trip at the schedule speed; capping it at forty-eight keeps the
 * `departureAt`/`etaAt` pair from implying an impossible average.
 */
const MIN_TRIP_HOURS = 6;
const MAX_TRIP_HOURS = 48;

/** Fraction of the run treated as "still loading". */
const LOADING_FRACTION = 0.06;

/** Fraction of the run past which the vehicle is treated as arrived. */
const ARRIVED_FRACTION = 0.94;

/** Fixed instant the rolling schedules are measured from. */
const SCHEDULE_EPOCH_MS = Date.UTC(2024, 0, 1);

/**
 * Generates the live tracking feed for a registration number.
 *
 * Everything this returns is invented, and the response says so in `source` and
 * `attribution` on every single call. It exists because the real feed — a
 * telematics box on each lorry, posting to a gateway — does not exist yet, and
 * the screen that will read it does. Building it against a generator keeps the
 * contract honest: when the gateway arrives, only this class changes.
 *
 * THE MODEL
 *
 * Identity is seeded from the registration number alone, so a plate always
 * describes the same lorry, the same driver, the same consignment and the same
 * route. Pull the same plate tomorrow and it is the same lorry on the same run.
 * That is what makes it usable as a fixture rather than as noise.
 *
 * Position is the one thing that moves, and it moves with the clock. A lorry on
 * this kind of route does the run repeatedly, so the schedule is a rolling
 * cycle: the vehicle's phase into that cycle is seeded from its plate, and its
 * progress is that phase advanced by real elapsed time. Two consequences worth
 * being explicit about, because they are load-bearing:
 *
 *   - The same plate queried twice in the same second returns the same
 *     position. Refresh and nothing jumps; wait five minutes and the lorry has
 *     moved five minutes down the road.
 *   - At the end of a cycle the vehicle wraps back to the origin. That wrap is
 *     an artefact of the model, not something a real feed would do, and the
 *     `etaAt`/`departureAt` pair always describes the current cycle so the
 *     timestamps stay coherent either side of it.
 *
 * A `Math.random()` implementation would look identical for exactly one page
 * load and then contradict itself. That is the failure this design exists to
 * avoid.
 *
 * No database is touched. When a real source lands it will need a persistence
 * story; a read-through generator does not.
 */
@Injectable()
export class TrackingService {
  /** The live feed for one vehicle. */
  track(vehicleNumber: string): LiveVehicleTracking {
    const registration = normaliseRegistration(vehicleNumber);

    // The DTO has already rejected anything that does not look like a plate, so
    // this is a second gate rather than the first. It is here because the
    // service is also callable directly, and a malformed plate reaching the
    // generator would silently produce a plausible-looking lorry for it.
    if (!REGISTRATION_PATTERN.test(vehicleNumber)) {
      throw new BadRequestException(
        `"${vehicleNumber}" is not an Indian registration number. Expected a format like JK-05-AB-1234.`,
      );
    }

    const identity = mulberry32(hashString(`${registration}|identity`));
    const route = mulberry32(hashString(`${registration}|route`));
    const schedule = mulberry32(hashString(`${registration}|schedule`));

    const origin = pickSeeded(TRACKING_ORIGINS, identity);
    const destination = this.pickDestination(origin, route);

    const driver = {
      name: pickSeeded(TRACKING_DRIVER_NAMES, identity),
      contact: this.contactFor(registration, 'driver'),
    };
    const owner = {
      name: pickSeeded(TRACKING_OWNER_NAMES, identity),
      // No number for the owner. The brief asks for a name only, and every
      // field like this that is not invented is one fewer plausible-looking
      // detail a reader could act on.
      contact: null,
    };

    const vehicleSpec = pickSeeded(TRACKING_VEHICLES, identity);
    const commodity = pickSeeded(TRACKING_COMMODITIES, identity);

    const vehicle = {
      registrationNumber: registration,
      displayNumber: formatRegistration(registration, vehicleNumber),
      type: vehicleSpec.type,
      capacityTonnes: vehicleSpec.capacityTonnes,
    };

    const path = buildRoutePath(origin, destination, route);
    const totalDistanceKm = round(path[path.length - 1].distanceFromOriginKm, 1);

    const { departureAt, etaAt, progressFraction } = this.schedule(
      schedule,
      totalDistanceKm,
    );

    const coveredKm = round(totalDistanceKm * progressFraction, 1);
    const position = buildPosition(
      path,
      coveredKm,
      totalDistanceKm,
      progressFraction,
      origin,
      destination,
    );

    const status = statusFor(progressFraction);

    const fill = floatSeeded(identity, 0.55, 1);
    const quantityValue = Math.max(
      1,
      Math.round(vehicleSpec.capacityTonnes * fill * commodity.perTonne),
    );

    return {
      vehicle,
      shipment: {
        id: shipmentId(registration),
        commodity: commodity.name,
        quantity: { value: quantityValue, unit: commodity.unit },
      },
      driver,
      owner,
      route: { origin, destination, totalDistanceKm, path },
      status,
      progress: {
        percent: round(progressFraction * 100, 1),
        coveredKm,
        remainingKm: round(totalDistanceKm - coveredKm, 1),
      },
      position,
      departureAt: departureAt.toISOString(),
      etaAt: etaAt.toISOString(),
      events: buildEvents(departureAt, etaAt, origin, destination),
      source: 'simulated',
      attribution:
        'KashRoot simulated tracking — the vehicle, its crew and its position are generated from the registration number, not reported by a telematics device',
      fetchedAt: new Date().toISOString(),
    };
  }

  /**
   * Choose a destination at least `MIN_TRIP_KM` from the origin.
   *
   * Walks the list from a seeded starting index rather than redrawing until
   * something qualifies, so the choice stays deterministic and the loop is
   * bounded by the list. If nothing clears the bar — which the current
   * catalogue does not allow, but a future edit could — the farthest option
   * wins, because a short route is a worse answer than a long one.
   */
  private pickDestination(origin: TrackingPlace, rand: () => number): TrackingPlace {
    const start = Math.floor(rand() * TRACKING_DESTINATIONS.length);
    let farthest: TrackingPlace = TRACKING_DESTINATIONS[start];
    let farthestKm = -1;

    for (let offset = 0; offset < TRACKING_DESTINATIONS.length; offset += 1) {
      const candidate = TRACKING_DESTINATIONS[(start + offset) % TRACKING_DESTINATIONS.length];
      const distanceKm = haversineKm(origin.lat, origin.lng, candidate.lat, candidate.lng);

      if (distanceKm >= MIN_TRIP_KM) return candidate;
      if (distanceKm > farthestKm) {
        farthestKm = distanceKm;
        farthest = candidate;
      }
    }

    return farthest;
  }

  /**
   * A contact number that cannot ring anybody.
   *
   * Built by prefixing nine seeded digits with a leading 5. Indian mobile
   * numbers start 6, 7, 8 or 9, so the result is not a dialable number in any
   * operator's range — which is the whole point. A realistic-looking generated
   * number belongs to a real stranger, and someone reading a tracking screen is
   * exactly the kind of person who would tap it.
   */
  private contactFor(registration: string, role: string): string {
    const rand = mulberry32(hashString(`${registration}|contact|${role}`));
    let digits = SIMULATED_CONTACT_PREFIX;

    for (let i = 1; i < SIMULATED_CONTACT_DIGITS; i += 1) {
      digits += Math.floor(rand() * 10);
    }

    return `+91 ${digits.slice(0, 5)} ${digits.slice(5)}`;
  }

  /**
   * The rolling schedule for this vehicle, and where it currently sits in it.
   *
   * See the class docblock for why this cycles rather than running once a day.
   */
  private schedule(
    rand: () => number,
    totalDistanceKm: number,
  ): { departureAt: Date; etaAt: Date; progressFraction: number } {
    const durationHours = clamp(
      totalDistanceKm / SCHEDULE_SPEED_KMPH + DWELL_HOURS,
      MIN_TRIP_HOURS,
      MAX_TRIP_HOURS,
    );
    const durationMs = durationHours * 3_600_000;

    // Where in the cycle this vehicle sits. Drawn once per plate, so it is
    // stable; combined with elapsed time, it is what makes the lorry move.
    const phaseMs = floatSeeded(rand, 0, durationMs);

    const now = Date.now();
    const elapsedMs = positiveModulo(now - SCHEDULE_EPOCH_MS + phaseMs, durationMs);

    const departureAt = new Date(now - elapsedMs);
    const etaAt = new Date(departureAt.getTime() + durationMs);

    return { departureAt, etaAt, progressFraction: elapsedMs / durationMs };
  }
}

// ── Route drawing ───────────────────────────────────────────────────────────

/**
 * Draw a plausible road between two places.
 *
 * A straight line between the endpoints reads immediately as placeholder art.
 * This lays waypoints along that line and pushes each one sideways by a smooth
 * wobble — two out-of-phase sine terms, so the deviations do not repeat and the
 * path has bends at more than one scale, the way a real highway does.
 *
 * The wobble is multiplied by `sin(pi * t)`, which is zero at both ends. That
 * is what guarantees the route still starts exactly at the collection centre
 * and finishes exactly at the mandi gate no matter how large the deviation
 * grows in the middle: no amount of tuning the amplitudes can detach either
 * endpoint.
 */
function buildRoutePath(
  origin: TrackingPlace,
  destination: TrackingPlace,
  rand: () => number,
): RoutePathPoint[] {
  const dLat = destination.lat - origin.lat;
  const dLng = destination.lng - origin.lng;
  const straight = Math.hypot(dLat, dLng) || 1e-9;

  // Unit vector perpendicular to the straight line, in degree space.
  const perpLat = -dLng / straight;
  const perpLng = dLat / straight;

  const phase1 = rand() * Math.PI * 2;
  const phase2 = rand() * Math.PI * 2;
  const amp1 = 0.55 + rand() * 0.45;
  const amp2 = 0.2 + rand() * 0.3;
  const freq1 = 1 + Math.floor(rand() * 2);
  const freq2 = 3 + Math.floor(rand() * 3);
  const ampSum = amp1 + amp2;
  const budget = straight * MAX_LATERAL_FRACTION;

  const points: RoutePathPoint[] = [];
  let cumulativeKm = 0;
  let previous: { lat: number; lng: number } | null = null;

  for (let index = 0; index <= ROUTE_WAYPOINTS; index += 1) {
    const t = index / ROUTE_WAYPOINTS;
    const taper = Math.sin(t * Math.PI);
    const wobble =
      (amp1 * Math.sin(t * Math.PI * freq1 + phase1) +
        amp2 * Math.sin(t * Math.PI * freq2 + phase2)) /
      ampSum;

    const offset = wobble * taper * budget;
    const point = {
      lat: round(origin.lat + dLat * t + perpLat * offset, 5),
      lng: round(origin.lng + dLng * t + perpLng * offset, 5),
    };

    if (previous) {
      cumulativeKm += haversineKm(previous.lat, previous.lng, point.lat, point.lng);
    }

    points.push({ ...point, distanceFromOriginKm: round(cumulativeKm, 3) });
    previous = point;
  }

  return points;
}

/** The point on the drawn path at a given distance from the origin. */
function locateOnPath(
  path: RoutePathPoint[],
  targetKm: number,
): { point: { lat: number; lng: number }; from: RoutePathPoint; to: RoutePathPoint } {
  for (let index = 1; index < path.length; index += 1) {
    const from = path[index - 1];
    const to = path[index];

    if (to.distanceFromOriginKm >= targetKm) {
      const segmentKm = to.distanceFromOriginKm - from.distanceFromOriginKm;
      const t = segmentKm <= 0 ? 0 : (targetKm - from.distanceFromOriginKm) / segmentKm;
      return { point: lerpPoint(from, to, t), from, to };
    }
  }

  // Past the end of the path — only reachable when the lorry has arrived.
  const last = path[path.length - 1];
  return { point: { lat: last.lat, lng: last.lng }, from: path[path.length - 2] ?? last, to: last };
}

/** Build the current GPS reading. */
function buildPosition(
  path: RoutePathPoint[],
  coveredKm: number,
  totalDistanceKm: number,
  progressFraction: number,
  origin: TrackingPlace,
  destination: TrackingPlace,
): VehiclePosition {
  const { point, from, to } = locateOnPath(path, coveredKm);

  const remainingKm = Math.max(0, totalDistanceKm - coveredKm);
  const nearestEndpoint =
    coveredKm <= remainingKm
      ? { name: origin.name, distanceKm: coveredKm }
      : { name: destination.name, distanceKm: remainingKm };

  const moving = statusFor(progressFraction) === 'in_transit';
  const speedKmph = moving
    ? // Smooth rather than jittery: a GPS feed reports a vehicle accelerating
      // and slowing, not a fresh random draw every second.
      Math.round(clamp(34 + 14 * Math.sin(progressFraction * Math.PI * 2.5), 18, 62))
    : 0;

  return {
    lat: point.lat,
    lng: point.lng,
    speedKmph,
    headingDeg: bearingDeg(from.lat, from.lng, to.lat, to.lng),
    nearestLandmark: nearestEndpoint.name,
    distanceFromOriginKm: round(coveredKm, 1),
    distanceToDestinationKm: round(remainingKm, 1),
    recordedAt: new Date().toISOString(),
  };
}

// ── Derived values ──────────────────────────────────────────────────────────

/** Which of the three states the run is in, from its progress. */
function statusFor(progressFraction: number): ShipmentStatus {
  if (progressFraction < LOADING_FRACTION) return 'loading';
  if (progressFraction >= ARRIVED_FRACTION) return 'delivered';
  return 'in_transit';
}

/**
 * The consignment timeline.
 *
 * Only ever three lines, all of them derived from the schedule rather than
 * invented: loading started, departure, and arrival. The arrival carries
 * `occurred: false` until it happens, so the client can render a projection as
 * a projection instead of quietly presenting a future time as a fact.
 */
function buildEvents(
  departureAt: Date,
  etaAt: Date,
  origin: TrackingPlace,
  destination: TrackingPlace,
): TrackingEvent[] {
  const now = Date.now();

  const lines: { at: Date; label: string; place: string }[] = [
    { at: new Date(departureAt.getTime() - 55 * 60_000), label: 'Loading started', place: origin.name },
    { at: departureAt, label: 'Departed', place: origin.name },
    { at: etaAt, label: 'Arrival at mandi', place: destination.name },
  ];

  return lines.map((line) => ({
    at: line.at.toISOString(),
    label: line.label,
    place: line.place,
    occurred: line.at.getTime() <= now,
  }));
}

/** A short, stable reference for the consignment. */
function shipmentId(registration: string): string {
  const tail = hashString(`${registration}|shipment`).toString(36).toUpperCase();
  return `KR-${tail.slice(0, 6).padStart(6, '0')}`;
}

// ── Small numeric helpers ───────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** `%` in JavaScript keeps the sign of the dividend; this never goes negative. */
function positiveModulo(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

/** Round to `places` decimals without the float noise `toFixed` leaves behind. */
function round(value: number, places: number): number {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
}
