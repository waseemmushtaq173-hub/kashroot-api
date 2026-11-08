/**
 * Shapes for the live mandi feed.
 *
 * Kept separate from the catalogue (which holds the actual hubs and commodity
 * anchors) so the data file can import these types without a cycle.
 */

/**
 * Where a set of prices actually came from.
 *
 * Only `agmarknet` exists now: prices are published daily arrival prices from
 * real regulated market boards. The distinction travels on every response so
 * the client can show provenance.
 */
export type PriceSource = 'agmarknet';

/** Sale unit a price is quoted in. Agmarknet publishes per quintal (100 kg). */
export type PriceUnit = 'quintal' | 'kg';

/** Whether an upstream price feed publishes for a hub's state. */
export type HubCoverage = 'live';

/** One selectable market hub the feed can resolve a request to. */
export interface MandiHub {
  id: string;
  /** Label for the location selector. */
  label: string;
  state: string;
  /**
   * The exact state string the upstream feed indexes by.
   */
  upstreamState: string;
  /** Roughly the hub's trading centre — accurate enough to pick a state. */
  lat: number;
  lng: number;
  coverage: HubCoverage;
  /** Representative physical market boards, used in the card sub-label. */
  markets: string[];
}

/** A commodity the feed can be asked for. */
export interface MandiCommodity {
  name: string;
  unit: PriceUnit;
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

/** A source of mandi prices. The Agmarknet provider is the only implementation. */
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
   * every successful serve. An empty board reports itself as empty; no
   * generated rows are ever substituted.
   */
  note: string | null;
}
