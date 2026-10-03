import { ListingStatus, Prisma } from '@prisma/client';

/**
 * The mapping layer between the Prisma Listing entity and the JSON the web
 * client actually consumes.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The client's PublicListing type (kashroot-web/src/lib/api/buyer.ts) is not the
 * database shape. It uses `unit`, `stockQuantity`, `commodity`, `originRegion`
 * (a display string, not an id), `images`, `farmerName` and `trustGate`, none of
 * which are columns on Listing. Returning raw Prisma rows therefore does not
 * "mostly work" — the discover page reads `listing.images[0]`, which throws on
 * undefined rather than rendering an empty state. Every field the client reads
 * is produced here, deliberately, in one place.
 */

/**
 * Every relation the mapper below reads. Shared by list and detail queries.
 *
 * Prisma.validator rather than a plain `: Prisma.ListingInclude` annotation:
 * the annotation widens the type, and GetPayload can then no longer tell that
 * `farmerProfile` is always present and `category`/`originRegion` are nullable.
 * The validator keeps the literal shape while still type-checking the argument.
 */
export const LISTING_INCLUDE = Prisma.validator<Prisma.ListingInclude>()({
  farmerProfile: true,
  category: true,
  originRegion: true,
  photos: { orderBy: { sortOrder: 'asc' } },
  // The Listing side of the ListingCertification join is named `certifications`,
  // not `listingCertifications` — the join model itself carries the latter name.
  certifications: { include: { certification: true } },
});

export type ListingWithRelations = Prisma.ListingGetPayload<{
  include: typeof LISTING_INCLUDE;
}>;

/**
 * The client's status vocabulary is not the database's.
 *
 * Prisma has five states (DRAFT, ACTIVE, SOLD_OUT, ARCHIVED, FROZEN); the farmer
 * dashboard is typed against three ('DRAFT' | 'PUBLISHED' | 'SUSPENDED') and
 * indexes two Records with the value:
 *
 *   LISTING_STATUS_LABEL[l.status]   // dashboard/page.tsx:18
 *   LISTING_STATUS_CLASS[l.status]   // dashboard/page.tsx:24
 *
 * Handing it a raw 'ACTIVE' renders an empty badge (both lookups miss) and, worse,
 * the Unpublish button is gated on `l.status === 'PUBLISHED'` (:138) so a farmer
 * could publish a listing and then have no way to take it down. The translation
 * belongs here, next to every other DB-to-client conversion, rather than being
 * pushed onto the dashboard.
 */
export type ClientListingStatus = 'DRAFT' | 'PUBLISHED' | 'SUSPENDED';

const STATUS_TO_CLIENT: Record<ListingStatus, ClientListingStatus> = {
  DRAFT: 'DRAFT',
  // Both are live on the marketplace; the difference is stock, which the client
  // already receives as `stockQuantity` and renders as "0 kg stock".
  ACTIVE: 'PUBLISHED',
  SOLD_OUT: 'PUBLISHED',
  // FROZEN is an admin moderation hold, which is what the dashboard labels
  // "Suspended". ARCHIVED is unreachable here (findMine excludes it and public
  // reads 404 on it) but the Record must stay total.
  FROZEN: 'SUSPENDED',
  ARCHIVED: 'SUSPENDED',
};

/**
 * The inverse map, used to turn a client-facing status filter into the database
 * values that satisfy it.
 *
 * Deliberately not the exact inverse of STATUS_TO_CLIENT: ARCHIVED is omitted, so
 * `?status=SUSPENDED` cannot resurrect a soft-deleted listing into a farmer's
 * list. Only the forward map needs to be total.
 */
const CLIENT_TO_STATUSES: Record<ClientListingStatus, ListingStatus[]> = {
  DRAFT: [ListingStatus.DRAFT],
  PUBLISHED: [ListingStatus.ACTIVE, ListingStatus.SOLD_OUT],
  SUSPENDED: [ListingStatus.FROZEN],
};

export function toClientStatus(status: ListingStatus): ClientListingStatus {
  return STATUS_TO_CLIENT[status];
}

export function toDbStatuses(status: ClientListingStatus): ListingStatus[] {
  return CLIENT_TO_STATUSES[status];
}

/** Matches the frontend's TrustGate union in lib/api/buyer.ts. */
export type TrustGate = 'buy_now' | 'request_appointment';

/**
 * The trust gate is hardcoded to the permissive value for now.
 *
 * NO TRUST RULE EXISTS IN THIS CODEBASE. The client comment asserts the value is
 * "backend-computed" and uses it to choose between an instant Buy CTA and a
 * "request appointment" CTA, but grep for trustGate across src/ and prisma/
 * returns nothing to compute it from. Defaulting to 'buy_now' is what the
 * product decision asked for; when the real rule lands (KYC status, trustScore,
 * order history) it belongs here, in one place.
 */
const TRUST_GATE: TrustGate = 'buy_now';

/**
 * Listing has a `stock` Int column and an `availableQty` Decimal column.
 * `stock` is the one that matters: orders.service.ts checks
 * `quantity > listing.stock` and decrements it. `availableQty` is referenced
 * only by inventory-reservations.service.ts, which is excluded from the build.
 * So `stock` is the single source of truth for what a buyer can order, and it is
 * what the client's `stockQuantity` reads.
 */
export function toPublicListing(listing: ListingWithRelations) {
  const certificationNames = listing.certifications.map(
    (lc) => lc.certification.name,
  );

  return {
    id: listing.id,
    title: listing.title,
    commodity: listing.category?.name ?? '',
    description: listing.description ?? '',
    // Prisma Decimal serialises to a JSON string, but the client types this as
    // `number` and does arithmetic on it, so convert rather than let "120.0000"
    // stringify its way into the UI.
    pricePerUnit: Number(listing.pricePerUnit),
    currency: listing.currency,
    unit: listing.unitOfSale,
    stockQuantity: listing.stock,
    originRegion: listing.originRegion?.name ?? '',
    certifications: certificationNames,
    isOrganic: certificationNames.some((n) => n.toLowerCase() === 'organic'),
    // Photos exist as ListingPhoto.fileKey rows, but nothing in this codebase
    // resolves a storage key to a URL (no CDN or bucket base URL is configured
    // anywhere), so there is no honest value to return yet. An empty array is
    // what the client handles correctly — `images[0]` then falls through to the
    // placeholder instead of dereferencing undefined.
    images: [] as string[],
    farmerName: listing.farmerProfile.displayName,
    // No rating rule is implemented: Review.rating exists, but averaging it per
    // farmer is a new query and a product decision about visibility. The client
    // type is `number | null` and hides the badge when null, so null is honest.
    farmerRating: null as number | null,
    trustGate: TRUST_GATE,
    createdAt: listing.createdAt.toISOString(),

    // Not required by PublicListing, but FarmerListing (lib/api/farmer.ts) reads
    // both, so including them lets one shape serve the buyer and farmer screens.
    status: STATUS_TO_CLIENT[listing.status],
    updatedAt: listing.updatedAt.toISOString(),

    // ─── Edit-form prefill ───────────────────────────────────────────────────
    // Consumed by the farmer edit form (farmer/listings/[id]/edit). Both were
    // missing from this payload, which is what blocked that page: a form opened
    // without them renders blank controls and then saves those blanks back over
    // real data on submit, so the omission was destructive, not cosmetic.

    /**
     * Listing has two date columns, harvestStart and harvestEnd, but the form
     * collects exactly one date — a single `type="date"` input (new/page.tsx:478)
     * that both create and update read into harvestStart. So harvestStart is the
     * only column that can round-trip; harvestEnd is deliberately not surfaced
     * rather than being reported as if it were the same field.
     *
     * Sliced to YYYY-MM-DD instead of shipped as a full ISO timestamp because
     * that is the only format a date input's `value` accepts: given anything
     * longer the control renders empty, silently losing a date the farmer had
     * already set. The slice is also why reading UTC is correct — Prisma parses
     * a date-only string as midnight UTC (`new Date('2026-09-15')` becomes
     * 2026-09-15T00:00:00.000Z), so toISOString() and the submitted form value
     * agree on the calendar day and the value round-trips unchanged.
     */
    harvestDate: listing.harvestStart
      ? listing.harvestStart.toISOString().slice(0, 10)
      : null,

    /**
     * minOrderQty is a Decimal(12,4) and serialises to the JSON string
     * "1.0000", so it needs the same conversion pricePerUnit gets above or the
     * edit form prefills with a quoted decimal.
     *
     * Typed as a number rather than the string the form's `type="number"` input
     * holds. This return shape is PublicListing, shared with the buyer contract,
     * where its siblings pricePerUnit and stockQuantity are already numbers;
     * making one quantity a string to save the edit page a String() call would
     * leave the payload internally inconsistent for no gain, since the edit page
     * has to convert those two fields anyway.
     */
    minimumOrderQuantity: Number(listing.minOrderQty),
  };
}

export type PublicListing = ReturnType<typeof toPublicListing>;
