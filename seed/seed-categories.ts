/**
 * seed-categories.ts — baseline commodity categories
 *
 * WHY THIS EXISTS
 * ---------------
 * The public listing contract (kashroot-web/src/lib/api/buyer.ts) exposes a
 * `commodity` field that maps to Category.name, and POST /listings resolves the
 * farmer's commodity string against this table, returning 400 for anything it
 * cannot find. With an empty categories table every listing would be rejected
 * and every search would return nothing, so these rows are a hard prerequisite
 * for the marketplace to function at all.
 *
 * IDEMPOTENT: upserts on slug (the only unique column), so re-running this is
 * safe and will not duplicate or clobber existing rows.
 *
 * Run with:
 *   npx ts-node -r tsconfig-paths/register seed/seed-categories.ts
 *
 * This is deliberately separate from seed/seed.ts, which inserts dummy farmers
 * and orders and should not be run against the live database.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const CATEGORIES = [
  { name: 'Apples', slug: 'apples' },
  { name: 'Walnuts', slug: 'walnuts' },
  { name: 'Saffron', slug: 'saffron' },
  { name: 'Honey', slug: 'honey' },
];

async function main() {
  for (const category of CATEGORIES) {
    await prisma.category.upsert({
      where: { slug: category.slug },
      // update name only, so an admin's manual rename is corrected to the
      // canonical label but nothing else on the row is disturbed
      update: { name: category.name },
      create: category,
    });
  }

  const all = await prisma.category.findMany({
    select: { name: true, slug: true },
    orderBy: { name: 'asc' },
  });
  console.log(`categories in DB (${all.length}):`);
  for (const c of all) console.log(`  ${c.slug.padEnd(12)} ${c.name}`);
}

main()
  .catch((err) => {
    console.error('seed-categories failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
