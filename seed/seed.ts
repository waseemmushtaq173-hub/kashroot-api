/**
 * KashRoot — Development Seed Script
 * ⚠️  DUMMY DATA ONLY. Gated behind NODE_ENV check.
 *     Never imported by production entrypoints.
 *     Run: NODE_ENV=development npx ts-node -r tsconfig-paths/register seed/seed.ts
 */

import { PrismaClient } from '@prisma/client';
import * as argon2 from 'argon2';
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
  console.log('\ud83c Seeding KashRoot development database...');

  // --- Regions ---
  /*
   * The origins offered by the farmer listing form. Names must match
   * kashroot-web/src/lib/listing-options.ts character-for-character:
   * ListingsService.resolveRegionId matches a submitted region against
   * Region.name (exact, case-insensitive) and stores null when nothing matches,
   * without raising an error. So a name that differs by so much as an
   * ampersand is a listing saved with no origin and no signal to anyone.
   *
   * Only 2 of these existed when the form offered 14, which meant 12 states
   * could be selected by a farmer and then silently discarded.
   *
   * KNOWN MISMATCH: the Kashmir row is named 'Kashmir Valley' while the form
   * offers 'Jammu & Kashmir', so that one option still resolves to null. Left
   * unchanged deliberately — renaming a live region row is a data decision, not
   * a seeding one.
   */
  const kashmir = await prisma.region.upsert({
    where: { id: 'region-kashmir' },
    update: {},
    create: {
      id: 'region-kashmir',
      name: 'Kashmir Valley',
      countryCode: 'IN',
      isActive: true,
    },
  });

  const OTHER_REGIONS = [
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

  for (const name of OTHER_REGIONS) {
    // Deterministic ids (region-uttar-pradesh) rather than generated uuids, so
    // re-running the seed updates these rows instead of duplicating them.
    const id = `region-${name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    await prisma.region.upsert({
      where: { id },
      update: { name },
      create: { id, name, countryCode: 'IN', isActive: true },
    });
  }

  // --- Roles & Permissions ---
  /*
   * Both lists come from src/modules/rbac/rbac.permissions.ts so the seeded
   * rows and the permissions the API enforces can never drift apart. Adding a
   * role there is all that is needed here.
   */
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

  // --- Seed users (DUMMY) ---
  const dummyPassword = await argon2.hash('DevPassword123!');

  const superAdmin = await prisma.user.upsert({
    where: { email: 'superadmin@kashroot.dev' },
    update: {},
    create: {
      email: 'superadmin@kashroot.dev',
      passwordHash: dummyPassword,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      userRoles: { create: { roleId: roles['SUPER_ADMIN'].id } },
    },
  });

  const regionalAdmin = await prisma.user.upsert({
    where: { email: 'kashmirops@kashroot.dev' },
    update: {},
    create: {
      email: 'kashmirops@kashroot.dev',
      passwordHash: dummyPassword,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      userRoles: { create: { roleId: roles['REGIONAL_ADMIN'].id, regionId: kashmir.id } },
    },
  });

  const farmerUser = await prisma.user.upsert({
    where: { email: 'farmer@kashroot.dev' },
    update: {},
    create: {
      email: 'farmer@kashroot.dev',
      passwordHash: dummyPassword,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      userRoles: { create: { roleId: roles['FARMER'].id } },
    },
  });

  const buyerUser = await prisma.user.upsert({
    where: { email: 'buyer@kashroot.dev' },
    update: {},
    create: {
      email: 'buyer@kashroot.dev',
      passwordHash: dummyPassword,
      status: 'ACTIVE',
      emailVerifiedAt: new Date(),
      userRoles: { create: { roleId: roles['BUYER'].id } },
    },
  });
  console.log('  \u2713 Seed users created');

  // --- Farmer + Buyer profiles ---
  const farmerProfile = await prisma.farmerProfile.upsert({
    where: { userId: farmerUser.id },
    update: {},
    create: {
      userId: farmerUser.id,
      displayName: '[DEV] Ahmed Mir Farms',
      bio: 'Third-generation saffron farmer from Pampore, Kashmir.',
      originRegionId: kashmir.id,
      kycStatus: 'VERIFIED',
      kycSubmittedAt: new Date(),
      kycReviewedAt: new Date(),
      kycReviewedBy: regionalAdmin.id,
      trustScore: 85,
    },
  });

  const buyerProfile = await prisma.buyerProfile.upsert({
    where: { userId: buyerUser.id },
    update: {},
    create: {
      userId: buyerUser.id,
      displayName: '[DEV] Priya Organics Delhi',
      buyerType: 'DOMESTIC_OTHER_REGION',
      defaultCurrency: 'INR',
    },
  });
  console.log('  \u2713 Farmer + Buyer profiles seeded');

  // --- Categories ---
  const saffronCat = await prisma.category.upsert({
    where: { slug: 'saffron' },
    update: {},
    create: { name: 'Saffron', slug: 'saffron' },
  });
  const appleCat = await prisma.category.upsert({
    where: { slug: 'apples' },
    update: {},
    create: { name: 'Apples', slug: 'apples' },
  });
  console.log('  \u2713 Categories seeded');

  // --- Listing ---
  const listing = await prisma.listing.upsert({
    where: { id: 'dev-listing-saffron-1' },
    update: {},
    create: {
      id: 'dev-listing-saffron-1',
      farmerProfileId: farmerProfile.id,
      categoryId: saffronCat.id,
      originRegionId: kashmir.id,
      title: '[DEV] Kashmiri Mongra Saffron — Grade A+',
      description: 'Premium Mongra saffron hand-harvested from the Pampore crocus fields.',
      variety: 'Mongra',
      unitOfSale: 'gram',
      pricePerUnit: 350,
      currency: 'INR',
      minOrderQty: 5,
      availableQty: 1000,
      harvestStart: new Date('2026-10-15'),
      harvestEnd: new Date('2026-11-30'),
      qualityGrade: 'A+',
      status: 'ACTIVE',
    },
  });
  console.log('  \u2713 Sample listing seeded');

  console.log('\n\ud83c Seed complete.');
  console.log('\n\u26a0\ufe0f  All credentials above are DUMMY / dev-only:');
  console.log('    Email: superadmin@kashroot.dev  Password: DevPassword123!');
  console.log('    Email: farmer@kashroot.dev       Password: DevPassword123!');
  console.log('    Email: buyer@kashroot.dev        Password: DevPassword123!');
  console.log('    NEVER use in or near a production environment.\n');
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
