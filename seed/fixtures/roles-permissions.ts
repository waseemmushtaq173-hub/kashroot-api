/**
 * KashRoot — Roles & Permissions seed fixture
 * DEV / TEST ONLY — never imported by production entrypoints.
 * Gated by NODE_ENV check in seed/seed.ts.
 */

export const ROLES = [
  'SUPER_ADMIN',
  'REGIONAL_ADMIN',
  'FARMER',
  'BUYER',
  'LOGISTICS_PARTNER',
  'SUPPORT_MODERATOR',
  'SYSTEM',
] as const;

export type RoleName = (typeof ROLES)[number];

export interface PermissionDef {
  key: string;
  description: string;
  roles: RoleName[];
}

export const PERMISSIONS: PermissionDef[] = [
  // Auth
  { key: 'auth:login',    description: 'Login to the platform',        roles: ['SUPER_ADMIN','REGIONAL_ADMIN','FARMER','BUYER','LOGISTICS_PARTNER','SUPPORT_MODERATOR'] },
  { key: 'auth:mfa:setup', description: 'Set up / manage MFA',         roles: ['SUPER_ADMIN','REGIONAL_ADMIN','FARMER','BUYER'] },

  // Users
  { key: 'user:read:own',        description: 'Read own user profile',         roles: ['SUPER_ADMIN','REGIONAL_ADMIN','FARMER','BUYER','LOGISTICS_PARTNER','SUPPORT_MODERATOR'] },
  { key: 'user:update:own',      description: 'Update own user profile',        roles: ['SUPER_ADMIN','REGIONAL_ADMIN','FARMER','BUYER','LOGISTICS_PARTNER','SUPPORT_MODERATOR'] },
  { key: 'user:read:any',        description: 'Read any user profile',          roles: ['SUPER_ADMIN','REGIONAL_ADMIN','SUPPORT_MODERATOR'] },
  { key: 'user:suspend:global',  description: 'Suspend any user globally',      roles: ['SUPER_ADMIN'] },
  { key: 'user:suspend:regional',description: 'Suspend user in own region',     roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },
  { key: 'user:delete:global',   description: 'Delete (pseudonymise) any user', roles: ['SUPER_ADMIN'] },
  { key: 'user:role:assign',     description: 'Assign roles to users',          roles: ['SUPER_ADMIN'] },

  // KYC
  { key: 'kyc:submit:own',              description: 'Submit own KYC',                      roles: ['FARMER'] },
  { key: 'kyc:document:upload:own',     description: 'Upload own KYC documents',            roles: ['FARMER'] },
  { key: 'kyc:document:read:regional',  description: 'Read KYC documents in region',        roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },
  { key: 'kyc:review:regional',         description: 'View KYC review queue for region',    roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },
  { key: 'kyc:approve:regional',        description: 'Approve KYC in region',               roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },
  { key: 'kyc:reject:regional',         description: 'Reject KYC in region',                roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },

  // Listings
  { key: 'listing:create:own',    description: 'Create own listing',               roles: ['FARMER'] },
  { key: 'listing:update:own',    description: 'Update own listing',               roles: ['FARMER'] },
  { key: 'listing:delete:own',    description: 'Delete own listing',               roles: ['FARMER'] },
  { key: 'listing:read:any',      description: 'Read any listing',                 roles: ['SUPER_ADMIN','REGIONAL_ADMIN','FARMER','BUYER','SUPPORT_MODERATOR'] },
  { key: 'listing:freeze:regional', description: 'Freeze listing in own region',  roles: ['SUPER_ADMIN','REGIONAL_ADMIN','SUPPORT_MODERATOR'] },
  { key: 'listing:freeze:global', description: 'Freeze any listing globally',      roles: ['SUPER_ADMIN'] },

  // Appointments
  { key: 'appointment:request:own',       description: 'Request an appointment (buyer)',   roles: ['BUYER'] },
  { key: 'appointment:approve:own',       description: 'Confirm appointment (farmer)',     roles: ['FARMER'] },
  { key: 'appointment:reschedule:own',    description: 'Reschedule own appointment',       roles: ['FARMER','BUYER'] },
  { key: 'appointment:cancel:own',        description: 'Cancel own appointment',           roles: ['FARMER','BUYER'] },
  { key: 'appointment:mark-completed:own',description: 'Mark appointment completed (farmer)', roles: ['FARMER'] },
  { key: 'appointment:read:any',          description: 'Read any appointment (admin)',     roles: ['SUPER_ADMIN','REGIONAL_ADMIN','SUPPORT_MODERATOR'] },

  // Orders
  { key: 'order:place:own',          description: 'Place an order (buyer)',              roles: ['BUYER'] },
  { key: 'order:read:own',           description: 'Read own orders',                    roles: ['FARMER','BUYER'] },
  { key: 'order:read:any',           description: 'Read any order (admin)',              roles: ['SUPER_ADMIN','REGIONAL_ADMIN','SUPPORT_MODERATOR'] },
  { key: 'order:cancel:own',         description: 'Cancel own order',                   roles: ['FARMER','BUYER'] },
  { key: 'order:status:update:own',  description: 'Update order status (farmer/logi)',  roles: ['FARMER','LOGISTICS_PARTNER'] },
  { key: 'order:refund:regional',    description: 'Issue refund in region',             roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },
  { key: 'order:refund:global',      description: 'Issue refund globally',              roles: ['SUPER_ADMIN'] },

  // Payments
  { key: 'payment:read:own', description: 'Read own payment details', roles: ['FARMER','BUYER'] },
  { key: 'payment:read:any', description: 'Read any payment (admin)', roles: ['SUPER_ADMIN'] },

  // Payouts
  { key: 'payout:read:own',      description: 'Read own payout ledger',       roles: ['FARMER'] },
  { key: 'payout:read:any',      description: 'Read any payout (admin)',       roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },
  { key: 'payout:release:global',description: 'Release any payout',            roles: ['SUPER_ADMIN'] },
  { key: 'payout:hold:regional', description: 'Hold payout in region',         roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },

  // Shipments
  { key: 'shipment:read:assigned',          description: 'Read assigned shipments',          roles: ['LOGISTICS_PARTNER'] },
  { key: 'shipment:status:update:assigned', description: 'Update assigned shipment status',  roles: ['LOGISTICS_PARTNER'] },
  { key: 'shipment:pod:upload:assigned',    description: 'Upload proof of delivery',         roles: ['LOGISTICS_PARTNER'] },
  { key: 'shipment:read:own',               description: 'Read own order shipments',         roles: ['FARMER','BUYER'] },
  { key: 'shipment:read:any',               description: 'Read any shipment (admin)',        roles: ['SUPER_ADMIN','REGIONAL_ADMIN','SUPPORT_MODERATOR'] },

  // Disputes — split permissions (see ADR #8)
  { key: 'dispute:open:own',         description: 'Open a dispute on own order',           roles: ['FARMER','BUYER'] },
  { key: 'dispute:read:own',         description: 'Read own disputes',                     roles: ['FARMER','BUYER'] },
  { key: 'dispute:read:any',         description: 'Read any dispute (admin/mod)',          roles: ['SUPER_ADMIN','REGIONAL_ADMIN','SUPPORT_MODERATOR'] },
  { key: 'dispute:recommend',        description: 'Add moderator recommendation (no resolve)', roles: ['SUPER_ADMIN','REGIONAL_ADMIN','SUPPORT_MODERATOR'] },
  { key: 'dispute:resolve:regional', description: 'Resolve dispute in assigned region',    roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },
  { key: 'dispute:resolve:global',   description: 'Override/resolve any dispute',         roles: ['SUPER_ADMIN'] },

  // Reviews
  { key: 'review:create:own', description: 'Submit a review',              roles: ['FARMER','BUYER'] },
  { key: 'review:delete:any', description: 'Remove any review (moderation)', roles: ['SUPER_ADMIN','REGIONAL_ADMIN','SUPPORT_MODERATOR'] },

  // Admin / Platform
  { key: 'region:create',           description: 'Create a new region',              roles: ['SUPER_ADMIN'] },
  { key: 'region:update',           description: 'Update region config',              roles: ['SUPER_ADMIN'] },
  { key: 'fee:config:update',       description: 'Create new fee config version',    roles: ['SUPER_ADMIN'] },
  { key: 'analytics:read:global',   description: 'Read platform-wide analytics',    roles: ['SUPER_ADMIN'] },
  { key: 'analytics:read:regional', description: 'Read regional analytics',          roles: ['SUPER_ADMIN','REGIONAL_ADMIN'] },
  { key: 'audit_log:read',          description: 'Read audit logs',                  roles: ['SUPER_ADMIN'] },
  { key: 'notification:send:global',description: 'Send platform-wide notifications', roles: ['SUPER_ADMIN'] },
  { key: 'category:manage',         description: 'Create/update listing categories', roles: ['SUPER_ADMIN'] },
];
