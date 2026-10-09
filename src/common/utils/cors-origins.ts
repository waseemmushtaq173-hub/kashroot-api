/**
 * CORS origin allowlist.
 *
 * `origin: true` reflects whatever Origin the request carried back in
 * Access-Control-Allow-Origin. Combined with `credentials: true` that lets any
 * website on the internet make credentialed requests to this API using a
 * logged-in visitor's refresh cookie and read the responses — the browser's
 * same-origin protection is exactly what the reflected header waives. So the
 * allowlist is built explicitly and anything outside it is refused.
 */

/**
 * Origins that are always allowed, whatever the environment.
 *
 * The Android build runs inside Capacitor, which serves the app from a local
 * WebView origin rather than from FRONTEND_URL, and sends that origin on every
 * direct call to this API. `https://localhost` is the Android default
 * (`androidScheme: 'https'`); `capacitor://localhost` is the iOS one, listed so
 * an iOS build does not fail the same way. Neither is reachable by a remote
 * site, so neither widens the browser attack surface.
 */
export const CAPACITOR_ORIGINS = ['https://localhost', 'capacitor://localhost'] as const;

/**
 * Builds the final allowlist from the configured values.
 *
 * Blank entries are dropped (an unset env var reads as ''), duplicates are
 * collapsed, and trailing slashes are trimmed because an Origin header never
 * has one — 'http://localhost:3000/' would otherwise never match anything.
 */
export function resolveAllowedOrigins(
  configured: readonly (string | undefined)[],
): string[] {
  const cleaned = configured
    .filter((value): value is string => typeof value === 'string')
    .flatMap((value) => value.split(','))
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter((value) => value.length > 0);

  return [...new Set(cleaned)];
}

/** The signature the `cors` package expects for a dynamic origin check. */
export type CorsOriginCallback = (
  err: Error | null,
  allow?: boolean,
) => void;

/**
 * Origin check for `app.enableCors({ origin: ... })`.
 *
 * A request with no Origin header is allowed: that is a server-to-server call,
 * a curl, a health probe or a same-origin navigation, none of which CORS is
 * concerned with and none of which a browser would send cross-site.
 *
 * A disallowed origin is answered with `false`, not an Error. Returning false
 * omits the Access-Control-Allow-Origin header, which is what makes the browser
 * block the response; throwing would turn every stray preflight into a logged
 * 500 and hand an attacker an easy way to fill the error tracker.
 */
export function buildCorsOriginCheck(allowedOrigins: readonly string[]) {
  const allowed = new Set(allowedOrigins);

  return (origin: string | undefined, callback: CorsOriginCallback): void => {
    if (!origin) return callback(null, true);
    callback(null, allowed.has(origin.replace(/\/+$/, '')));
  };
}
