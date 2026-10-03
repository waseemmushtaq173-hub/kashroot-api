/**
 * The wire contract for the vehicle tracking module.
 *
 * Every field here is generated, and the shape says so: `source` is a required
 * literal and `attribution` is required, so a client cannot render this feed
 * without having been handed the string that tells it where the numbers came
 * from. That is deliberate. A tracking page is the one screen in this product
 * where a made-up value has a physical referent — a lorry, a driver, a phone
 * number — and a reader has no way to tell an invented one from a real one by
 * looking at it.
 */

/** Where a tracking record came from. One value today; see `TrackingService`. */
export type TrackingSource = 'simulated';

/** How far along the run the vehicle is. */
export type ShipmentStatus = 'loading' | 'in_transit' | 'delivered';

/** A coordinate pair. */
export interface GeoPoint {
  lat: number;
  lng: number;
}

/** A named place on the route. */
export interface TrackingPlace extends GeoPoint {
  name: string;
  district: string;
  state: string;
}

/** The vehicle itself. */
export interface VehicleIdentity {
  /** Normalised, separator-free: `JK05AB1234`. Stable, and the cache key. */
  registrationNumber: string;
  /** Grouped for display: `JK-05-AB-1234`. */
  displayNumber: string;
  type: string;
  capacityTonnes: number;
}

/**
 * A person on the consignment.
 *
 * `contact` is nullable because not every party has one we are willing to
 * invent. Where a value is present it is drawn from a range that cannot be
 * dialled — see `SIMULATED_CONTACT_PREFIX` in the catalogue for why that
 * matters more than it looks.
 */
export interface TrackingParty {
  name: string;
  contact: string | null;
}

/** One leg of the drawn route, in order from origin to destination. */
export interface RoutePathPoint extends GeoPoint {
  /** Distance travelled from the origin along the drawn path, in km. */
  distanceFromOriginKm: number;
}

/** Where the truck is now, and what it is doing. */
export interface VehiclePosition extends GeoPoint {
  speedKmph: number;
  /** Compass bearing of travel, 0–359. */
  headingDeg: number;
  /** The endpoint the truck is currently nearest to, and how far from it. */
  nearestLandmark: string;
  distanceFromOriginKm: number;
  distanceToDestinationKm: number;
  /** When this reading was taken. Moves with the clock; see `TrackingService`. */
  recordedAt: string;
}

/** One line of the consignment timeline. */
export interface TrackingEvent {
  at: string;
  label: string;
  place: string | null;
  /** False while the event is still a projection rather than something that happened. */
  occurred: boolean;
}

/** The whole response of `GET /api/v1/tracking/:vehicleNumber`. */
export interface LiveVehicleTracking {
  vehicle: VehicleIdentity;
  shipment: {
    id: string;
    commodity: string;
    quantity: { value: number; unit: string };
  };
  driver: TrackingParty;
  owner: TrackingParty;
  route: {
    origin: TrackingPlace;
    /** The destination mandi. */
    destination: TrackingPlace;
    totalDistanceKm: number;
    /** The full drawn polyline, origin first. */
    path: RoutePathPoint[];
  };
  status: ShipmentStatus;
  progress: {
    /** 0–100, one decimal. */
    percent: number;
    coveredKm: number;
    remainingKm: number;
  };
  position: VehiclePosition;
  departureAt: string;
  etaAt: string;
  events: TrackingEvent[];
  source: TrackingSource;
  attribution: string;
  fetchedAt: string;
}
