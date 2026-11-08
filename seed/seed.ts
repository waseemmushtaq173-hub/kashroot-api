/**
 * KashRoot — Development Seed Script
 *
 * Creates only the structural reference data the platform needs to operate:
 * regions, roles, and permissions. No users, profiles, listings, or advisory
 * rows are seeded — every feature starts empty and is populated by real users
 * through live database writes. Gated behind NODE_ENV=development.
 *
 * Run: NODE_ENV=development npx ts-node -r tsconfig-paths/register seed/seed.ts
 */

import { PrismaClient } from '@prisma/client';

import {
  PERMISSION_DEFS,
  SEEDED_ROLE_NAMES,
} from '../src/modules/rbac/rbac.permissions';

if (process.env.NODE_ENV === 'production') {
  console.error('\u274c Seed script must not run in production. Aborting.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log('\ud83c Seeding KashRoot development database (reference data only)...');

  // --- Regions ---
  const regions = [
    'Jammu & Kashmir',
    'Punjab',
    'Himachal Pradesh',
    'Uttarakhand',
    'Maharashtra',
    'Karnataka',
    'Kerala',
    'Tamil Nadu',
    'Andhra Pradesh',
    'West Bengal',
    'Rajasthan',
    'Gujarat',
    'Madhya Pradesh',
    'Uttar Pradesh',
  ];

  for (const name of regions) {
    const id = `region-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    await prisma.region.upsert({
      where: { id },
      update: { name },
      create: { id, name, countryCode: 'IN', isActive: true },
    });
  }
  console.log('  \u2713 Regions seeded');

  // --- Roles & Permissions ---
  const roles: Record<string, { id: string }> = {};
  for (const name of SEEDED_ROLE_NAMES) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    roles[name] = role;
  }

  for (const def of PERMISSION_DEFS) {
    const perm = await prisma.permission.upsert({
      where: { key: def.key },
      update: {},
      create: { key: def.key },
    });
    for (const roleName of def.roles) {
      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId: roles[roleName].id, permissionId: perm.id } },
        update: {},
        create: { roleId: roles[roleName].id, permissionId: perm.id },
      });
    }
  }
  console.log('  \u2713 Roles + permissions seeded');

  console.log('\n\u2713 Seed complete (reference data only — no dummy users or listings).');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
