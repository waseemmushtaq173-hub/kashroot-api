import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ListingStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthenticatedUser } from '../../common/types/request-with-user.type';
import { ListingsQueryDto } from './dto/listings-query.dto';
import { MyListingsQueryDto } from './dto/my-listings-query.dto';
import { CreateListingDto } from './dto/create-listing.dto';
import { UpdateListingDto } from './dto/update-listing.dto';
import {
  LISTING_INCLUDE,
  ListingWithRelations,
  PublicListing,
  toDbStatuses,
  toPublicListing,
} from './listings.mapper';

/**
 * Statuses a listing may be read through the public GET /listings/:id route.
 * DRAFT is excluded because publishing is a deliberate farmer action — an
 * unauthenticated caller must not be able to read a listing's price before its
 * owner has published it. FROZEN and ARCHIVED are moderation/history states.
 */
const PUBLICLY_VIEWABLE: ReadonlySet<string> = new Set(['ACTIVE', 'SOLD_OUT']);

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * GET /listings — public marketplace search.
   * Returns the { data, total, page, limit } envelope the web client expects,
   * with every row passed through the mapper.
   */
  async findAll(
    query: ListingsQueryDto,
  ): Promise<{ data: PublicListing[]; total: number; page: number; limit: number }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 12;
    const where = this.buildWhere(query);

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: LISTING_INCLUDE,
        orderBy: { createdAt: Prisma.SortOrder.desc },
        // `page` is 1-based on the wire (the client's state starts at 1), so the
        // offset is (page - 1) * limit. Treating it as 0-based would silently
        // skip the newest page of results.
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { data: rows.map(toPublicListing), total, page, limit };
  }

  /**
   * GET /listings/:id — a single listing.
   *
   * Public statuses are readable by anyone. A non-public status (DRAFT, FROZEN,
   * ARCHIVED) is readable only by the farmer who owns it or an admin, which is
   * what lets a farmer open their own draft to edit it.
   *
   * Everyone else still gets 404 rather than 403, deliberately: a 403 would
   * confirm that a listing with that id exists, turning this route into an
   * existence oracle for other people's unpublished drafts.
   *
   * `viewer` is optional because the route is public — an anonymous request
   * arrives with no identity at all.
   */
  async findOne(id: string, viewer?: AuthenticatedUser): Promise<PublicListing> {
    const listing = await this.loadOrThrow(id);

    if (!PUBLICLY_VIEWABLE.has(listing.status)) {
      if (!this.isOwnerOrAdmin(listing.farmerProfile.userId, viewer)) {
        throw new NotFoundException(`Listing ${id} not found`);
      }
    }

    return toPublicListing(listing);
  }

  /**
   * GET /listings/mine — the calling farmer's own listings, drafts included.
   *
   * Unlike the public search this is scoped by the caller's own farmer profile
   * rather than by status, so it can show DRAFT rows the public route hides.
   * There is no "listings for an arbitrary farmer" variant: the farmer id comes
   * from the verified token, never from the query string.
   */
  async findMine(
    userId: string,
    query: MyListingsQueryDto,
  ): Promise<{ data: PublicListing[]; total: number; page: number; limit: number }> {
    const farmerProfile = await this.prisma.farmerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!farmerProfile) {
      throw new ForbiddenException('Only farmer accounts have listings.');
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? 12;

    const where: Prisma.ListingWhereInput = {
      farmerProfileId: farmerProfile.id,
      // Archived is a soft delete kept for order history, not a state this list
      // shows: the farmer's own dashboard is a working list, so a deleted
      // listing drops out of it. Excluding it also keeps every row inside the
      // client's three-state vocabulary, which has nothing to render 'ARCHIVED'
      // as. An explicit status filter is honoured instead, but still cannot
      // reach archived rows (see CLIENT_TO_STATUSES).
      status: query.status
        ? { in: toDbStatuses(query.status) }
        : { not: ListingStatus.ARCHIVED },
    };

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.listing.findMany({
        where,
        include: LISTING_INCLUDE,
        orderBy: { createdAt: Prisma.SortOrder.desc },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.listing.count({ where }),
    ]);

    return { data: rows.map(toPublicListing), total, page, limit };
  }

  /**
   * POST /listings — create a listing for the calling farmer.
   * Always created as DRAFT; publishing is a separate, KYC-gated action.
   */
  async create(userId: string, dto: CreateListingDto): Promise<PublicListing> {
    const farmerProfile = await this.prisma.farmerProfile.findUnique({
      where: { userId },
      select: { id: true },
    });
    if (!farmerProfile) {
      throw new ForbiddenException('Only farmer accounts can create listings.');
    }

    const category = await this.resolveCategory(dto.commodity);
    const originRegionId = dto.originRegion
      ? await this.resolveRegionId(dto.originRegion)
      : null;

    const created = await this.prisma.listing.create({
      data: {
        farmerProfileId: farmerProfile.id,
        categoryId: category.id,
        originRegionId,
        title: dto.title,
        description: dto.description ?? null,
        unitOfSale: dto.unit,
        pricePerUnit: dto.pricePerUnit,
        currency: dto.currency ?? 'INR',
        minOrderQty: dto.minimumOrderQuantity ?? 1,
        stock: dto.stockQuantity,
        harvestStart: dto.harvestDate ? new Date(dto.harvestDate) : null,
        status: 'DRAFT',
      },
    });

    await this.setCertifications(
      created.id,
      farmerProfile.id,
      dto.certifications,
      dto.isOrganic ?? false,
    );

    return toPublicListing(await this.loadOrThrow(created.id));
  }

  /** PATCH /listings/:id — partial update, owner (or admin) only. */
  async update(
    id: string,
    userId: string,
    roles: RoleName[],
    dto: UpdateListingDto,
  ): Promise<PublicListing> {
    const { farmerProfileId } = await this.assertOwnership(id, userId, roles);

    const data: Prisma.ListingUpdateInput = {};

    if (dto.title !== undefined) data.title = dto.title;
    if (dto.description !== undefined) data.description = dto.description;
    if (dto.unit !== undefined) data.unitOfSale = dto.unit;
    if (dto.pricePerUnit !== undefined) data.pricePerUnit = dto.pricePerUnit;
    if (dto.currency !== undefined) data.currency = dto.currency;
    if (dto.stockQuantity !== undefined) data.stock = dto.stockQuantity;
    if (dto.minimumOrderQuantity !== undefined) {
      data.minOrderQty = dto.minimumOrderQuantity;
    }
    if (dto.harvestDate !== undefined) {
      data.harvestStart = new Date(dto.harvestDate);
    }

    if (dto.commodity !== undefined) {
      const category = await this.resolveCategory(dto.commodity);
      data.category = { connect: { id: category.id } };
    }

    if (dto.originRegion !== undefined) {
      const regionId = await this.resolveRegionId(dto.originRegion);
      data.originRegion = regionId
        ? { connect: { id: regionId } }
        : { disconnect: true };
    }

    if (Object.keys(data).length > 0) {
      await this.prisma.listing.update({ where: { id }, data });
    }

    // Replaced rather than merged: the edit form submits the whole tag list it
    // is showing, so a tag the farmer removed has to actually disappear.
    if (dto.certifications !== undefined || dto.isOrganic !== undefined) {
      await this.setCertifications(
        id,
        farmerProfileId,
        dto.certifications,
        dto.isOrganic ?? false,
      );
    }

    return toPublicListing(await this.loadOrThrow(id));
  }

  /** DELETE /listings/:id — soft delete (archive), owner (or admin) only. */
  async remove(
    id: string,
    userId: string,
    roles: RoleName[],
  ): Promise<{ id: string; status: string; message: string }> {
    await this.assertOwnership(id, userId, roles);

    await this.prisma.listing.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });

    return { id, status: 'ARCHIVED', message: 'Listing archived.' };
  }

  /** PATCH /listings/:id/publish — make a listing visible on the marketplace. */
  async publish(
    id: string,
    userId: string,
    roles: RoleName[],
  ): Promise<PublicListing> {
    return this.setPublished(id, userId, roles, true);
  }

  /** PATCH /listings/:id/unpublish — return a listing to DRAFT. */
  async unpublish(
    id: string,
    userId: string,
    roles: RoleName[],
  ): Promise<PublicListing> {
    return this.setPublished(id, userId, roles, false);
  }

  /**
   * Drives the DRAFT <-> ACTIVE transition behind publish and unpublish.
   *
   * NOTE — the KYC gate is NOT implemented. The web client documents
   * `PATCH /listings/:id/publish` as "requires VERIFIED KYC (enforced by
   * backend)" (lib/api/farmer.ts:64) and the create-listing page says the same.
   * Nothing enforces it: any authenticated farmer can publish immediately. When
   * KYC lands, the check goes here, after assertOwnership and before the update,
   * so every caller of publish inherits it.
   */
  private async setPublished(
    id: string,
    userId: string,
    roles: RoleName[],
    publish: boolean,
  ): Promise<PublicListing> {
    await this.assertOwnership(id, userId, roles);

    const current = await this.prisma.listing.findUnique({
      where: { id },
      select: { status: true },
    });
    if (!current) throw new NotFoundException(`Listing ${id} not found`);

    // FROZEN is set by moderation, not by the farmer. Allowing them to flip it
    // would let anyone lift a hold placed on their own listing, so it is checked
    // before the transition rather than after.
    if (current.status === ListingStatus.FROZEN) {
      throw new ForbiddenException(
        'This listing is on hold following a moderation review and cannot be ' +
          'published or unpublished from the dashboard.',
      );
    }

    if (current.status === ListingStatus.ARCHIVED) {
      throw new BadRequestException(
        'This listing has been archived and can no longer be published.',
      );
    }

    const next: ListingStatus = publish
      ? ListingStatus.ACTIVE
      : ListingStatus.DRAFT;

    // Idempotent on purpose: re-publishing a live listing, or unpublishing one
    // that is already a draft, is the state the caller asked for. The dashboard
    // invalidates and refetches on success, so returning the row beats an error
    // on what is a harmless double-click.
    if (current.status !== next) {
      await this.prisma.listing.update({ where: { id }, data: { status: next } });
    }

    return toPublicListing(await this.loadOrThrow(id));
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async loadOrThrow(id: string): Promise<ListingWithRelations> {
    const listing = await this.prisma.listing.findUnique({
      where: { id },
      include: LISTING_INCLUDE,
    });
    if (!listing) throw new NotFoundException(`Listing ${id} not found`);
    return listing;
  }

  /**
   * True when the viewer is the farmer behind this listing, or an admin.
   *
   * Shared by findOne (may I read this unpublished listing?) and assertOwnership
   * (may I modify it?). The two must agree — if reading and writing used
   * different rules, one of them would drift.
   */
  private isOwnerOrAdmin(
    ownerUserId: string,
    viewer?: AuthenticatedUser,
  ): boolean {
    if (!viewer) return false;
    return this.isAdmin(viewer.roles) || ownerUserId === viewer.sub;
  }

  private isAdmin(roles: RoleName[]): boolean {
    return (
      roles.includes(RoleName.SUPER_ADMIN) ||
      roles.includes(RoleName.REGIONAL_ADMIN)
    );
  }

  /**
   * Confirms the caller may modify this listing. Admins pass; everyone else must
   * own the farmer profile behind it. Without this, any authenticated user could
   * edit or archive any listing on the platform.
   */
  private async assertOwnership(
    listingId: string,
    userId: string,
    roles: RoleName[],
  ): Promise<{ farmerProfileId: string }> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        farmerProfileId: true,
        farmerProfile: { select: { userId: true } },
      },
    });
    if (!listing) throw new NotFoundException(`Listing ${listingId} not found`);

    if (!this.isAdmin(roles) && listing.farmerProfile.userId !== userId) {
      throw new ForbiddenException('You can only modify your own listings.');
    }

    return { farmerProfileId: listing.farmerProfileId };
  }

  /**
   * Resolves the client's free-text commodity to a Category row.
   *
   * An unknown commodity is a 400 listing the valid options, not an implicit
   * create: otherwise any farmer could mint categories from typo'd input and the
   * marketplace facet would drift into noise.
   */
  private async resolveCategory(commodity: string) {
    const category = await this.prisma.category.findFirst({
      where: { name: { equals: commodity.trim(), mode: 'insensitive' } },
      select: { id: true, name: true },
    });

    if (!category) {
      const available = await this.prisma.category.findMany({
        select: { name: true },
        orderBy: { name: 'asc' },
      });
      const valid = available.map((c) => c.name).join(', ') || '(none configured)';
      throw new BadRequestException(
        `Unknown commodity '${commodity}'. Valid commodities: ${valid}.`,
      );
    }

    return category;
  }

  /**
   * Resolves a region id or name. Unresolved values become null rather than a
   * 400, because the farmer form offers 14 Indian states while the regions table
   * currently holds 2 rows — rejecting would block listing creation outright.
   * The data gap is worth closing by seeding regions, not by rejecting farmers.
   */
  private async resolveRegionId(input: string): Promise<string | null> {
    const region = await this.prisma.region.findFirst({
      where: {
        OR: [
          { id: input },
          { name: { equals: input.trim(), mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    return region?.id ?? null;
  }

  /**
   * Sets the listing's certification links to exactly the supplied names.
   *
   * Certification rows hang off FarmerProfile, not Listing, so one 'GI Tag' row
   * is shared across all of that farmer's listings rather than duplicated per
   * listing. New rows are created unverified — a farmer's claim stands until an
   * admin checks it.
   */
  private async setCertifications(
    listingId: string,
    farmerProfileId: string,
    names?: string[],
    isOrganic = false,
  ): Promise<void> {
    const wanted = new Set(
      (names ?? []).map((n) => n.trim()).filter((n) => n.length > 0),
    );
    if (isOrganic) wanted.add('Organic');

    await this.prisma.listingCertification.deleteMany({ where: { listingId } });

    for (const name of wanted) {
      const existing = await this.prisma.certification.findFirst({
        where: { farmerProfileId, name: { equals: name, mode: 'insensitive' } },
        select: { id: true },
      });

      const certification =
        existing ??
        (await this.prisma.certification.create({
          data: { farmerProfileId, name },
          select: { id: true },
        }));

      await this.prisma.listingCertification.create({
        data: { listingId, certificationId: certification.id },
      });
    }
  }

  private buildWhere(query: ListingsQueryDto): Prisma.ListingWhereInput {
    // Search is public, so only published listings are candidates.
    const where: Prisma.ListingWhereInput = { status: 'ACTIVE' };

    if (query.q) where.title = { contains: query.q, mode: 'insensitive' };
    if (query.currency) where.currency = query.currency;

    if (query.commodity) {
      where.category = {
        is: { name: { equals: query.commodity.trim(), mode: 'insensitive' } },
      };
    }

    if (query.minPrice !== undefined || query.maxPrice !== undefined) {
      where.pricePerUnit = {
        ...(query.minPrice !== undefined ? { gte: query.minPrice } : {}),
        ...(query.maxPrice !== undefined ? { lte: query.maxPrice } : {}),
      };
    }

    if (query.originRegion) {
      where.originRegion = {
        is: {
          OR: [
            { id: query.originRegion },
            { name: { equals: query.originRegion.trim(), mode: 'insensitive' } },
          ],
        },
      };
    }

    const certificationNames = (query.certifications ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0);
    if (query.isOrganic === true) certificationNames.push('Organic');

    // `some` and `none` are composed into one object rather than assigned to
    // where.certifications separately, because the second assignment would
    // silently overwrite the first whenever a caller sends both
    // isOrganic=false and an explicit certifications list.
    const certificationFilter: Prisma.ListingCertificationListRelationFilter = {};

    if (certificationNames.length > 0) {
      certificationFilter.some = {
        certification: {
          name: { in: certificationNames, mode: 'insensitive' },
        },
      };
    }

    // The false case needs its own branch. Testing `if (query.isOrganic)` treats
    // false exactly like "param not sent", so a buyer filtering for non-organic
    // produce received the organic listings as well — the filter did nothing.
    if (query.isOrganic === false) {
      certificationFilter.none = {
        certification: { name: { equals: 'Organic', mode: 'insensitive' } },
      };
    }

    if (Object.keys(certificationFilter).length > 0) {
      where.certifications = certificationFilter;
    }

    // query.trustGate is accepted for client-contract compatibility and
    // deliberately not applied — no trust rule exists to filter on, and the
    // mapper reports every listing as 'buy_now'.
    return where;
  }
}
