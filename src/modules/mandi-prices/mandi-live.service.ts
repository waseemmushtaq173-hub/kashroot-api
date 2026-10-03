import { BadRequestException, Injectable, Logger } from '@nestjs/common';

import {
  DEFAULT_COMMODITY,
  findCommodity,
  findHub,
  MANDI_COMMODITIES,
  MANDI_HUBS,
  nearestHub,
} from './mandi-catalogue';
import type {
  LiveMandiFeed,
  MandiHub,
  MandiLocationCatalogue,
  MandiProvider,
  MandiQuote,
  TrendPoint,
} from './mandi-live.types';
import { AgmarknetProvider } from './providers/agmarknet.provider';
import { SimulatedProvider } from './providers/simulated.provider';
import { QueryLiveMandiDto } from './dto/query-live-mandi.dto';

/** How a hub was chosen for a request. */
interface ResolvedHub {
  hub: MandiHub;
  resolvedBy: 'requested' | 'coordinates';
  distanceKm: number | null;
}

/**
 * The cacheable half of a feed.
 *
 * Everything except `location`. How a request was resolved — named hub or
 * browser fix, and how far away that fix was — describes the *request*, not the
 * prices, so caching it would let one caller's answer be handed to the next:
 * someone who pressed "Use my location" would be told they had named the hub,
 * with a null distance to match.
 */
type CachedPayload = Omit<LiveMandiFeed, 'location'>;

/**
 * Serves the location-resolved mandi feed.
 *
 * The one rule this class exists to enforce: a hub either has a real upstream
 * feed or it does not, and the answer is decided by `hub.coverage` alone. A
 * live hub is never back-filled with generated rows when its upstream is slow,
 * empty or down — it returns an empty board and says why. The alternative,
 * quietly substituting plausible numbers whenever the real feed is
 * inconvenient, would make the two indistinguishable on screen, and this board
 * is something a grower might price a harvest against.
 *
 * No database writes happen here. The feed is read-through only, which keeps
 * the live prices clear of the persisted `mandi_prices` benchmark table that
 * the admin sync path maintains.
 */
@Injectable()
export class MandiLiveService {
  private readonly logger = new Logger(MandiLiveService.name);

  /**
   * Responses are cached briefly, keyed by hub + commodity.
   *
   * Upstream is a free-tier third party: a per-request fan-out across a
   * dashboard that refetches on every selector change would be both slow and
   * rude. A minute is short enough that the board still reads as live — the
   * arrival dates it reports are daily anyway.
   */
  private readonly cache = new Map<
    string,
    { cachedAt: number; payload: CachedPayload }
  >();

  private static readonly CACHE_TTL_MS = 60_000;
  private static readonly CACHE_MAX_ENTRIES = 64;

  constructor(
    private readonly agmarknet: AgmarknetProvider,
    private readonly simulated: SimulatedProvider,
  ) {}

  /** Everything the location selector needs, in one round trip. */
  listLocations(): MandiLocationCatalogue {
    return {
      commodities: MANDI_COMMODITIES.map((c) => c.name),
      locations: MANDI_HUBS.map((hub) => ({
        id: hub.id,
        label: hub.label,
        state: hub.state,
        coverage: hub.coverage,
        markets: hub.markets,
      })),
    };
  }

  /** Resolve the request's location, then serve the feed for it. */
  async getFeed(query: QueryLiveMandiDto): Promise<LiveMandiFeed> {
    const { hub, resolvedBy, distanceKm } = this.resolveHub(query);

    const requested = query.commodity?.trim();
    const commodity = findCommodity(requested ?? DEFAULT_COMMODITY);

    if (requested && !commodity) {
      // An unknown commodity is a caller error, not an empty market. Saying so
      // is more useful than returning an empty board that looks like no
      // arrivals were reported today.
      throw new BadRequestException(
        `Unknown commodity "${requested}". Use GET /api/v1/mandi/locations for the supported list.`,
      );
    }

    const commodityName = commodity?.name ?? DEFAULT_COMMODITY;
    const cacheKey = `${hub.id}|${commodityName}`;

    const payload =
      this.readCache(cacheKey) ??
      (await this.loadPayload(hub, commodityName, cacheKey));

    // Location is attached here rather than cached, so it always describes the
    // request being answered right now.
    return {
      location: {
        id: hub.id,
        label: hub.label,
        state: hub.state,
        coverage: hub.coverage,
        resolvedBy,
        distanceKm,
      },
      ...payload,
    };
  }

  /**
   * Fetch the boards and history for a hub, and cache the result.
   *
   * Only successful serves are cached; a failed upstream should be retried on
   * the next request rather than pinned for a minute.
   */
  private async loadPayload(
    hub: MandiHub,
    commodityName: string,
    cacheKey: string,
  ): Promise<CachedPayload> {
    const provider = this.providerFor(hub);

    const { quotes, note } = await this.fetchQuotes(provider, hub, commodityName);
    const history = await this.fetchHistory(provider, hub, commodityName);

    const payload: CachedPayload = {
      commodity: commodityName,
      source: provider.source,
      attribution: provider.attribution,
      unitOfSale:
        quotes[0]?.unitOfSale ?? findCommodity(commodityName)?.unit ?? 'quintal',
      currency: 'INR',
      fetchedAt: new Date().toISOString(),
      asOf: latestArrival(quotes),
      prices: quotes,
      history,
      note,
    };

    if (quotes.length > 0) this.writeCache(cacheKey, payload);

    return payload;
  }

  /**
   * The provider that answers for a hub.
   *
   * Coverage is a property of the hub's state, not of whether the last request
   * happened to succeed, so this decision does not move around at runtime.
   */
  private providerFor(hub: MandiHub): MandiProvider {
    return hub.coverage === 'live' ? this.agmarknet : this.simulated;
  }

  /**
   * Fetch the boards for a hub.
   *
   * A live hub that cannot be read yields no rows and an explanation; a
   * modelled hub always yields rows, because that is what it is for.
   */
  private async fetchQuotes(
    provider: MandiProvider,
    hub: MandiHub,
    commodity: string,
  ): Promise<{ quotes: MandiQuote[]; note: string | null }> {
    try {
      const quotes = await provider.fetchQuotes(hub, commodity);

      if (quotes.length > 0) return { quotes, note: null };

      if (hub.coverage === 'modelled') {
        // The generator always returns one card per board, so this is
        // unreachable in practice; it is here so the branch cannot silently
        // return "no data" for a hub that is supposed to have some.
        return {
          quotes: [],
          note: `No modelled prices are available for ${commodity} at ${hub.label}.`,
        };
      }

      return {
        quotes: [],
        note: `The Agmarknet feed carries no published ${commodity} arrivals for ${hub.state} at the moment. The board is left empty rather than filled in.`,
      };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Mandi feed unavailable for ${hub.id}: ${reason}`);

      if (hub.coverage === 'modelled') {
        // Should not happen — the generator does no I/O — but falling through
        // to a real error beats rendering a blank screen with no explanation.
        return {
          quotes: [],
          note: `The modelled feed for ${hub.label} could not be generated.`,
        };
      }

      return {
        quotes: [],
        note: `The upstream Agmarknet feed for ${hub.state} could not be reached, so no prices are shown. ${reason}`,
      };
    }
  }

  /** History degrades to an empty series; the board itself is the point. */
  private async fetchHistory(
    provider: MandiProvider,
    hub: MandiHub,
    commodity: string,
  ): Promise<TrendPoint[]> {
    try {
      return await provider.fetchHistory(hub, commodity);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      this.logger.warn(`Mandi history unavailable for ${hub.id}: ${reason}`);
      return [];
    }
  }

  /**
   * Work out which hub the request is about.
   *
   * Naming a hub wins over coordinates, so an explicit selection is never
   * overridden by a stale browser fix. A named hub that does not exist is a
   * 400 rather than a silent fallback to somewhere else — quietly serving
   * Punjab to someone who asked for Srinagar is the kind of failure that looks
   * like it worked.
   */
  private resolveHub(query: QueryLiveMandiDto): ResolvedHub {
    if (query.location) {
      const hub = findHub(query.location);
      if (!hub) {
        throw new BadRequestException(
          `Unknown location "${query.location}". Use GET /api/v1/mandi/locations for the supported list.`,
        );
      }
      return { hub, resolvedBy: 'requested', distanceKm: null };
    }

    const lat = parseCoordinate(query.lat);
    const lng = parseCoordinate(query.lng);

    // Half a coordinate pair is a malformed request, not a location. Letting it
    // through would silently resolve against a zero for the missing half.
    if (lat === null || lng === null) {
      if (lat !== null || lng !== null) {
        throw new BadRequestException(
          'Supply `lat` and `lng` together, or name a `location`.',
        );
      }
      throw new BadRequestException(
        'Supply either `location` or both `lat` and `lng`.',
      );
    }

    // Range is checked here rather than in the DTO because the DTO carries the
    // raw strings; see the note on QueryLiveMandiDto.
    if (lat < -90 || lat > 90) {
      throw new BadRequestException('`lat` must be between -90 and 90.');
    }
    if (lng < -180 || lng > 180) {
      throw new BadRequestException('`lng` must be between -180 and 180.');
    }

    const { hub, distanceKm } = nearestHub(lat, lng);
    return {
      hub,
      resolvedBy: 'coordinates',
      distanceKm: Math.round(distanceKm),
    };
  }
  private readCache(key: string): CachedPayload | null {
    const hit = this.cache.get(key);
    if (!hit) return null;

    if (Date.now() - hit.cachedAt > MandiLiveService.CACHE_TTL_MS) {
      this.cache.delete(key);
      return null;
    }
    return hit.payload;
  }

  private writeCache(key: string, payload: CachedPayload): void {
    // Naive bound: the key space is hubs x commodities, so this only ever fills
    // up if the catalogue grows a lot. Evicting the oldest insertion keeps it
    // from growing without limit regardless.
    if (this.cache.size >= MandiLiveService.CACHE_MAX_ENTRIES) {
      const oldest = this.cache.keys().next();
      if (!oldest.done) this.cache.delete(oldest.value);
    }
    this.cache.set(key, { cachedAt: Date.now(), payload });
  }
}

/** The most recent arrival date across a set of quotes. */
function latestArrival(quotes: MandiQuote[]): string | null {
  let latest: string | null = null;
  for (const quote of quotes) {
    if (!latest || quote.arrivalDate > latest) latest = quote.arrivalDate;
  }
  return latest;
}

/**
 * Parse a decimal-degree query value.
 *
 * Returns null for absent, blank and unparseable input alike — the DTO has
 * already rejected anything that is not a decimal number, so by the time this
 * runs the only interesting question is whether a value was supplied at all.
 */
function parseCoordinate(raw: string | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  if (trimmed === '') return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}
