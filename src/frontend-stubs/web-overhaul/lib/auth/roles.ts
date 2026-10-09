/**
 * Portal roles for the dedicated sign-in pages (/login/farmer, /login/buyer,
 * /login/seller) that replace the global "Welcome Back" screen.
 *
 * Server-safe (no browser APIs), so the landing page and the login route can
 * both build links from it.
 *
 * The API's POST /auth/login is role-agnostic: one credential check, and the
 * user's roles come back on the response. Each portal therefore checks those
 * roles against ACCEPTED_BACKEND_ROLES after sign-in, rather than sending a role
 * up with the credentials.
 */
import { PORTALS } from '../portals';

export type PortalRole = 'farmer' | 'buyer' | 'seller';

export const PORTAL_ROLES: readonly PortalRole[] = ['farmer', 'buyer', 'seller'];

export const ROLE_LABELS: Record<PortalRole, string> = {
  farmer: 'Farmer',
  buyer: 'Buyer',
  seller: 'Seller',
};

/** Backend `UserRole` values each portal admits. */
export const ACCEPTED_BACKEND_ROLES: Record<PortalRole, readonly string[]> = {
  farmer: ['FARMER'],
  buyer: ['BUYER'],
  // The API has no SELLER role yet. Farmers own listings, so they sell through
  // this portal too; SELLER is listed so a future role works without a change.
  seller: ['SELLER', 'FARMER'],
};

/** Mirrors the API's SELF_REGISTERABLE_ROLES — only these may sign up unaided. */
export const SELF_REGISTER_ROLES: readonly PortalRole[] = ['farmer', 'buyer'];

/** Where each portal lands after sign-in when no `next` was requested. */
export const ROLE_HOME: Record<PortalRole, string> = {
  farmer: PORTALS.mandi.href,
  buyer: PORTALS.priceComparison.href,
  seller: PORTALS.priceComparison.href,
};

/** Auxiliary auth routes in the web app — adjust if yours differ. */
export const AUTH_ROUTES = {
  register: (role: PortalRole) => `/register?role=${role}`,
  forgotPassword: '/forgot-password',
} as const;

export function isPortalRole(value: string): value is PortalRole {
  return (PORTAL_ROLES as readonly string[]).includes(value);
}

/** Link to a portal's sign-in, carrying where to go afterwards. */
export function loginHref(role: PortalRole, next?: string): string {
  return next ? `/login/${role}?next=${encodeURIComponent(next)}` : `/login/${role}`;
}

/** The portal sign-in that admits a backend role, if any. */
export function portalRoleForBackendRole(backendRole: string): PortalRole | null {
  return PORTAL_ROLES.find((role) => ACCEPTED_BACKEND_ROLES[role].includes(backendRole)) ?? null;
}

/**
 * `next` arrives from the query string, so it is attacker-controlled. Only a
 * same-origin path is honoured: "//evil.com", "/\evil.com" and "/<TAB>/evil.com"
 * all resolve to another host in a browser and would turn sign-in into an open
 * redirect. Resolving against a placeholder origin with the same URL parser the
 * browser uses catches every such spelling, not just the ones listed here.
 */
export function safeNextPath(next: string | null | undefined, fallback: string): string {
  if (!next || !next.startsWith('/')) return fallback;
  const base = 'https://kashroot.invalid';
  try {
    const url = new URL(next, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : fallback;
  } catch {
    return fallback;
  }
}
