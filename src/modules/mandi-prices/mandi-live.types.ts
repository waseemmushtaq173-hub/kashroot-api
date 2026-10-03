/**
 * Shapes for the live mandi feed.
 *
 * Kept separate from the catalogue (which holds the actual hubs and commodity
 * anchors) so the data file can import these types without a cycle.
 */

/**
 * Where a set of prices actually came from.
 *
 * This travels on every response instead of being inferred by the client,
 * because the two feeds are not interchangeable: `agmarknet` rows are published
 * daily arrival prices from real regulated market boards, while `simulated` rows
 * are generated locally for hubs that no upstream feed covers. A price board is
 * read as a price board, so the distinction has to survive the trip to screen.
 */
export type PriceSource = 'agmarknet' | 'simulated';

/** Sale unit a price is quoted in. Agmarknet publishes per quintal (100 kg). */
export type PriceUnit = 'quintal' | 'kg';

/** Whether an upstream price feed publishes for a hub's state. */
export type HubCoverage = 'live' | 'modelled';

/** One selectable market hub the feed can resolve a request to. */
export interface MandiHub {
  id: string;
  /** Label for the location selector. */
  label: string;
  state: string;
  /**
   * The exact state string the upstream feed indexes by. Only meaningful when
   * `coverage` is 'live'; null otherwise.
   */
  upstreamState: string | null;
  /** Roughly the hub's trading centre — accurate enough to pick a state. */
  lat: number;
  lng: number;
  coverage: HubCoverage;
  /** Representative physical market boards, used in the card sub-label. */
  markets: string[];
}

/** A commodity the feed can be asked for, with the anchor its series derives from. */
export interface MandiCommodity {
  name: string;
  unit: PriceUnit;
  /**
   * Illustrative wholesale anchor, in rupees. Used ONLY by the simulated
   * provider to centre a generated series — it is not ingested data and is
   * never served on a hub that has live coverage.
   */
  basePrice: number;
  /** Fractional day-to-day swing the generator applies around the trend. */
  volatility: number;
}

/** One market board's reading for one commodity. */
export interface MandiQuote {
  market: string;
  district: string | null;
  state: string;
  commodity: string;
  variety: string | null;
  grade: string | null;
  minPrice: number;
  maxPrice: number;
  modalPrice: number;
  unitOfSale: PriceUnit;
  currency: 'INR';
  /** ISO date (YYYY-MM-DD) of the arrival this reading is for. */
  arrivalDate: string;
}

/** One day of the aggregated price series for a state + commodity. */
export interface TrendPoint {
  arrivalDate: string;
  modalPrice: number;
  /** How many board readings the daily average was computed from. */
  dataPoints: number;
}

/** A source of mandi prices. Two implementations, selected by hub coverage. */
export interface MandiProvider {
  readonly source: PriceSource;
  /** Shown in the UI's provenance line. */
  readonly attribution: string;
  fetchQuotes(hub: MandiHub, commodity: string): Promise<MandiQuote[]>;
  fetchHistory(hub: MandiHub, commodity: string): Promise<TrendPoint[]>;
}

/** One entry in the location selector. */
export interface MandiLocationOption {
  id: string;
  label: string;
  state: string;
  coverage: HubCoverage;
  markets: string[];
}

/** Everything the location selector needs, in one round trip. */
export interface MandiLocationCatalogue {
  commodities: string[];
  locations: MandiLocationOption[];
}

/** The full response of GET /api/v1/mandi. */
export interface LiveMandiFeed {
  location: {
    id: string;
    label: string;
    state: string;
    coverage: HubCoverage;
    /** Whether the hub was named outright or derived from coordinates. */
    resolvedBy: 'requested' | 'coordinates';
    /** Present only when resolvedBy is 'coordinates'. */
    distanceKm: number | null;
  };
  commodity: string;
  source: PriceSource;
  attribution: string;
  unitOfSale: PriceUnit;
  currency: 'INR';
  fetchedAt: string;
  /** Latest arrival date present in `prices`; null when the feed is empty. */
  asOf: string | null;
  prices: MandiQuote[];
  /** Aggregated series for this state + commodity, oldest first. */
  history: TrendPoint[];
  /**
   * Set when the feed could not be served exactly as asked — currently only
   * when a live hub has no published rows for the requested commodity. Null on
   * every successful serve. The feed is never back-filled with generated rows
   * to hide this; an empty board reports itself as empty.
   */
  note: string | null;
}
