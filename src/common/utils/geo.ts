/**
 * Spherical geometry over lon/lat pairs.
 *
 * Small enough to live in one file, and load-bearing enough that it should not
 * be reimplemented per module. Every distance and bearing this API reports to a
 * client comes from here, so there is exactly one place to check when a figure
 * looks wrong.
 *
 * These treat the Earth as a sphere. Over the distances involved — a mandi
 * catchment, a lorry route — the error against an ellipsoidal model is a few
 * tenths of a percent, which is far below the precision anything here claims.
 */

/** Mean Earth radius, in kilometres. */
const EARTH_RADIUS_KM = 6371;

const toRad = (deg: number): number => (deg * Math.PI) / 180;
const toDeg = (rad: number): number => (rad * 180) / Math.PI;

/** Great-circle distance in kilometres between two coordinates. */
export function haversineKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;

  return 2 * EARTH_RADIUS_KM * Math.asin(Math.sqrt(a));
}

/**
 * Initial compass bearing from one coordinate to another, in degrees 0–359.
 *
 * "Initial" is the pedantic bit: a great circle's heading changes as you travel
 * it, so a bearing is only ever true at the point it was taken. Over a single
 * segment of a lorry route that difference is invisible, and quoting a terminal
 * bearing instead would be wrong at the only place it is displayed — the truck.
 */
export function bearingDeg(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const dLng = toRad(lng2 - lng1);

  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);

  return Math.round((toDeg(Math.atan2(y, x)) + 360) % 360);
}

/**
 * Linear interpolation between two coordinates.
 *
 * Interpolates in degree space rather than along the great circle. At the scale
 * of the routes drawn here the two are indistinguishable on screen, and degree
 * space is what the polyline renderer on the other end assumes when it draws
 * straight segments between the points it is given.
 */
export function lerpPoint(
  from: { lat: number; lng: number },
  to: { lat: number; lng: number },
  t: number,
): { lat: number; lng: number } {
  return {
    lat: from.lat + (to.lat - from.lat) * t,
    lng: from.lng + (to.lng - from.lng) * t,
  };
}
