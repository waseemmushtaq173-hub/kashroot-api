import { RoleName } from '@prisma/client';

/**
 * The permission catalogue — every permission key the platform recognises and
 * the roles that hold it.
 *
 * This is reference data, not runtime configuration: seed/seed.ts upserts it
 * into the permissions / role_permissions tables, and RbacService reads the
 * result back out of the database to stamp into each access token. It lives
 * here rather than inline in the seed so that adding a role means editing the
 * module that owns authorisation, and so tests can assert against the
 * catalogue without a database.
 *
 * Keys follow `resource:action[:scope]`, where the `:own` scope means the
 * holder may only touch rows they own — enforced in services as a Layer 2
 * ownership check (see RbacService), never by the key alone.
 */
export interface PermissionDef {
  key: string;
  roles: RoleName[];
}

export const PERMISSION_DEFS: readonly PermissionDef[] = [
  { key: 'user:suspend:global',        roles: ['SUPER_ADMIN'] },
  { key: 'user:suspend:regional',      roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
  { key: 'kyc:review',                 roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
  { key: 'kyc:document:read',          roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
  { key: 'kyc:submit:own',             roles: ['SUPER_ADMIN', 'FARMER', 'SELLER'] },
  { key: 'kyc:read:own',               roles: ['SUPER_ADMIN', 'FARMER', 'SELLER'] },
  { key: 'listing:create:own',         roles: ['SUPER_ADMIN', 'FARMER', 'SELLER'] },
  { key: 'listing:update:own',         roles: ['SUPER_ADMIN', 'FARMER', 'SELLER'] },
  { key: 'listing:freeze',             roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN', 'SUPPORT_MODERATOR'] },
  { key: 'listing:read:all',           roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN', 'BUYER', 'SUPPORT_MODERATOR'] },
  { key: 'appointment:create:own',     roles: ['SUPER_ADMIN', 'BUYER'] },
  { key: 'appointment:approve:own',    roles: ['SUPER_ADMIN', 'FARMER'] },
  { key: 'order:place',                roles: ['SUPER_ADMIN', 'BUYER'] },
  { key: 'order:refund:regional',      roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
  { key: 'order:refund:global',        roles: ['SUPER_ADMIN'] },
  { key: 'shipment:update:assigned',   roles: ['SUPER_ADMIN', 'LOGISTICS_PARTNER'] },
  { key: 'dispute:read',               roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN', 'SUPPORT_MODERATOR'] },
  { key: 'dispute:resolve',            roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
  { key: 'analytics:global',           roles: ['SUPER_ADMIN'] },
  { key: 'analytics:regional',         roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
  { key: 'analytics:own',              roles: ['SUPER_ADMIN', 'FARMER', 'BUYER', 'SELLER'] },
  { key: 'region:configure',           roles: ['SUPER_ADMIN'] },
  { key: 'fee:configure',              roles: ['SUPER_ADMIN'] },
  { key: 'role:assign',                roles: ['SUPER_ADMIN'] },
];

/**
 * Roles that must exist as rows before any user can be assigned one.
 *
 * Derived from the catalogue so a role can never be granted a permission
 * without also being seeded. SELLER arrives here through its entries above.
 */
export const SEEDED_ROLE_NAMES: readonly RoleName[] = [
  ...new Set(PERMISSION_DEFS.flatMap((def) => def.roles)),
  'SYSTEM', // holds no permissions; exists for machine-attributed audit rows
];

/** Every permission key held by a role, for assertions and admin tooling. */
export function permissionsForRole(role: RoleName): string[] {
  return PERMISSION_DEFS.filter((def) => def.roles.includes(role)).map((def) => def.key);
}
