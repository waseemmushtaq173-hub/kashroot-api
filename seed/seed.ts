/**
 * KashRoot — Development Seed Script
 * ⚠️  DUMMY DATA ONLY. Gated behind NODE_ENV check.
 *     Never imported by production entrypoints.
 *     Run: NODE_ENV=development npx ts-node -r tsconfig-paths/register seed/seed.ts
 */

import { PrismaClient, RoleName } from '@prisma/client';
import * as argon2 from 'argon2';

if (process.env.NODE_ENV === 'production') {
  console.error('\u274c Seed script must not run in production. Aborting.');
  process.exit(1);
}

const prisma = new PrismaClient();

async function main() {
  console.log('\ud83c Seeding KashRoot development database...');

  // --- Regions ---
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

  const punjab = await prisma.region.upsert({
    where: { id: 'region-punjab' },
    update: {},
    create: {
      id: 'region-punjab',
      name: 'Punjab',
      countryCode: 'IN',
      isActive: true,
    },
  });

  // --- Roles & Permissions ---
  const roleNames: RoleName[] = [
    'SUPER_ADMIN', 'REGIONAL_ADMIN', 'FARMER',
    'BUYER', 'LOGISTICS_PARTNER', 'SUPPORT_MODERATOR', 'SYSTEM',
  ];
  const roles: Record<string, { id: string }> = {};
  for (const name of roleNames) {
    const role = await prisma.role.upsert({
      where: { name },
      update: {},
      create: { name },
    });
    roles[name] = role;
  }

  const permissionDefs = [
    { key: 'user:suspend:global',        roles: ['SUPER_ADMIN'] },
    { key: 'user:suspend:regional',      roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
    { key: 'kyc:review',                 roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
    { key: 'kyc:document:read',          roles: ['SUPER_ADMIN', 'REGIONAL_ADMIN'] },
    { key: 'kyc:submit:own',             roles: ['SUPER_ADMIN', 'FARMER'] },
    { key: 'kyc:read:own',               roles: ['SUPER_ADMIN', 'FARMER'] },
    { key: 'listing:create:own',         roles: ['SUPER_ADMIN', 'FARMER'] },
    { key: 'listing:update:own',         roles: ['SUPER_ADMIN', 'FARMER'] },
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
    { key: 'analytics:own',              roles: ['SUPER_ADMIN', 'FARMER', 'BUYER'] },
    { key: 'region:configure',           roles: ['SUPER_ADMIN'] },
    { key: 'fee:configure',              roles: ['SUPER_ADMIN'] },
    { key: 'role:assign',                roles: ['SUPER_ADMIN'] },
  ];

  for (const def of permissionDefs) {
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
