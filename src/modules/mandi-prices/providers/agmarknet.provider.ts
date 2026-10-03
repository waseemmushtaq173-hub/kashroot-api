import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import type {
  MandiHub,
  MandiProvider,
  MandiQuote,
  PriceSource,
  TrendPoint,
} from '../mandi-live.types';

/** One row of the upstream `/v1/prices` payload. */
interface UpstreamPriceRow {
  market: string;
  district?: string | null;
  state: string;
  commodity: string;
  variety?: string | null;
  grade?: string | null;
  arrival_date: string;
  min_price: number;
  max_price: number;
  modal_price: number;
}

/** One row of the upstream `/v1/prices/history` payload. */
interface UpstreamHistoryRow {
  arrival_date: string;
  avg_modal_price: number;
  data_points: number;
}

/** The envelope both upstream endpoints wrap their rows in. */
interface UpstreamEnvelope<T> {
  success?: boolean;
  data?: T[];
}

/** Most boards to show at once. Beyond this the grid stops being readable. */
const MAX_MARKETS = 12;

/**
 * Default upstream: a keyless public mirror of Agmarknet's daily board prices.
 *
 * It carries only the states flagged `coverage: 'live'` in the catalogue — five
 * of them, and none of the boards this product is built around.
 */
const DEFAULT_BASE_URL = 'https://mandi-api.onrender.com/v1';

/**
 * Reads real daily mandi arrival prices from an Agmarknet-derived HTTP feed.
 *
 * The upstream is a public mirror of the Directorate of Marketing &
 * Inspection's daily board prices, addressed by state. It is a third party: it
 * is slow to wake, it rate-limits, and it carries only the states listed in
 * `MANDI_HUBS` with `coverage: 'live'`. Everything here is therefore written to
 * fail fast and loudly rather than to paper over an outage — the service above
 * turns a failure into an empty board that says so, never into substitute rows.
 *
 * Base URL comes from `MANDI_API_BASE_URL` so a deployment can point at
 * data.gov.in (which needs a key) or at its own cache without a code change.
 */
@Injectable()
export class AgmarknetProvider implements MandiProvider {
  readonly source: PriceSource = 'agmarknet';
  readonly attribution =
    'Agmarknet daily arrivals (Directorate of Marketing & Inspection), via the public Mandi Price API mirror';

  private readonly logger = new Logger(AgmarknetProvider.name);

  /**
   * Upstream runs on a free tier that sleeps when idle, where a cold request
   * can take the better part of a minute. Eight seconds is long enough for a
   * warm response and short enough that the dashboard is not left spinning —
   * past it we would rather report an empty board than hang the page.
   */
  private static readonly TIMEOUT_MS = 8000;

  constructor(private readonly config: ConfigService) {}

  private get baseUrl(): string {
    // `.trim() || default` rather than `?? default`: a blank entry in an env
    // file arrives as an empty string, and an empty base URL would build
    // relative request paths instead of falling back to the public mirror.
    const configured = this.config.get<string>('MANDI_API_BASE_URL')?.trim();
    return (configured || DEFAULT_BASE_URL).replace(/\/+$/, '');
  }

  /** Latest reading per market board for one commodity, newest boards first. */
  async fetchQuotes(hub: MandiHub, commodity: string): Promise<MandiQuote[]> {
    const state = hub.upstreamState ?? hub.state;

    const rows = await this.get<UpstreamPriceRow>('/prices', { state });

    // Filter locally as well as upstream: a feed that silently ignores an
    // unknown `commodity` would otherwise return every crop in the state, and
    // the board would show the wrong thing without ever looking broken.
    const wanted = commodity.trim().toLowerCase();
    const matching = rows.filter(
      (row) => (row.commodity ?? '').trim().toLowerCase() === wanted,
    );

    // One row per market, newest arrival wins, so a board that reported on
    // several days does not fill the grid with its own history.
    const latestPerMarket = new Map<string, UpstreamPriceRow>();
    for (const row of matching) {
      const key = row.market ?? 'Unknown market';
      const held = latestPerMarket.get(key);
      if (!held || row.arrival_date > held.arrival_date) {
        latestPerMarket.set(key, row);
      }
    }

    return [...latestPerMarket.values()]
      .sort((a, b) => (b.arrival_date ?? '').localeCompare(a.arrival_date ?? ''))
      .slice(0, MAX_MARKETS)
      .map((row) => this.toQuote(row, hub));
  }

  /** Aggregated daily series for the state + commodity, oldest point first. */
  async fetchHistory(
    hub: MandiHub,
    commodity: string,
  ): Promise<TrendPoint[]> {
    const state = hub.upstreamState ?? hub.state;

    const rows = await this.get<UpstreamHistoryRow>('/prices/history', {
      state,
      commodity,
    });

    return rows
      .map((row) => ({
        arrivalDate: row.arrival_date,
        modalPrice: Number(row.avg_modal_price),
        dataPoints: Number(row.data_points) || 0,
      }))
      .sort((a, b) => a.arrivalDate.localeCompare(b.arrivalDate));
  }

  /** Map one upstream row onto the feed's quote shape. */
  private toQuote(row: UpstreamPriceRow, hub: MandiHub): MandiQuote {
    return {
      market: row.market,
      district: row.district ?? null,
      state: row.state ?? hub.state,
      commodity: row.commodity,
      variety: row.variety ?? null,
      grade: row.grade ?? null,
      minPrice: Number(row.min_price),
      maxPrice: Number(row.max_price),
      modalPrice: Number(row.modal_price),
      // Agmarknet publishes every board price per quintal (100 kg). Reported
      // as-is: converting to a crate or a box would mean inventing a pack
      // weight, and a made-up divisor is exactly the kind of quiet arithmetic
      // that turns a real price into a wrong one.
      unitOfSale: 'quintal',
      currency: 'INR',
      arrivalDate: row.arrival_date,
    };
  }

  /**
   * Issue one upstream GET and unwrap its `data` array.
   *
   * Throws on timeout, transport error and non-2xx alike — all three mean the
   * same thing to the caller (no prices available right now), and the service
   * above translates them into a single honest "feed unavailable" state.
   */
  private async get<T>(
    path: string,
    params: Record<string, string>,
  ): Promise<T[]> {
    const query = new URLSearchParams(params).toString();
    const url = `${this.baseUrl}${path}${query ? `?${query}` : ''}`;

    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(),
      AgmarknetProvider.TIMEOUT_MS,
    );

    try {
      const res = await fetch(url, {
        headers: { Accept: 'application/json' },
        signal: controller.signal,
      });

      if (!res.ok) {
        throw new Error(`upstream responded ${res.status} ${res.statusText}`);
      }

      const body = (await res.json()) as UpstreamEnvelope<T>;
      return Array.isArray(body?.data) ? body.data : [];
    } catch (err) {
      const reason =
        err instanceof Error && err.name === 'AbortError'
          ? `timed out after ${AgmarknetProvider.TIMEOUT_MS}ms`
          : err instanceof Error
            ? err.message
            : String(err);

      this.logger.warn(`Upstream mandi fetch failed (${path}): ${reason}`);
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }
}
