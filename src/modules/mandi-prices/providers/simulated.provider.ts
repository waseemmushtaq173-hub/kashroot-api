import { Injectable } from '@nestjs/common';

import { hashString, mulberry32 } from '../../../common/utils/deterministic';
import {
  findCommodity,
  MANDI_COMMODITIES,
} from '../mandi-catalogue';
import type {
  MandiHub,
  MandiProvider,
  MandiQuote,
  PriceSource,
  PriceUnit,
  TrendPoint,
} from '../mandi-live.types';

/** Days of history the generated series carries. */
const SERIES_DAYS = 45;

/** Fallback anchor for a commodity outside the catalogue. */
const FALLBACK_ANCHOR = { unit: 'quintal' as PriceUnit, basePrice: 3000, volatility: 0.2 };

/**
 * Generates a price series for hubs that no upstream feed covers.
 *
 * Every figure this returns is invented. It exists so the dashboard has a
 * coherent shape to render for boards like Parimpora, Azadpur and Jaipur, which
 * the public feed does not publish, and it is deliberately loud about that:
 * `source` is 'simulated' and the attribution says so in as many words. The
 * service above only ever reaches for this provider on a hub flagged
 * `coverage: 'modelled'`, so a generated price can never be served on a board
 * that has real prices.
 *
 * The series is *deterministic*: it is seeded from the hub, the commodity and
 * the calendar date, so the same day always yields the same number. That is
 * what keeps it from behaving like data — refresh the page and nothing jumps,
 * which is the property a real feed has and a `Math.random()` mock does not.
 */
@Injectable()
export class SimulatedProvider implements MandiProvider {
  readonly source: PriceSource = 'simulated';
  readonly attribution =
    'KashRoot modelled series — generated locally from a fixed seed, not market data';

  /**
   * One quote per market board on the hub, spread deterministically around the
   * hub's latest generated value.
   */
  async fetchQuotes(hub: MandiHub, commodity: string): Promise<MandiQuote[]> {
    const series = this.fetchSeriesSync(hub, commodity);
    const latest = series[series.length - 1];
    const anchor = findCommodity(commodity) ?? FALLBACK_ANCHOR;

    return hub.markets.map((market) => {
      // Each board sits at its own stable offset from the hub figure, so the
      // cards differ from one another without wandering between requests.
      const rand = mulberry32(hashString(`${hub.id}|${commodity}|${market}`));
      const offset = 1 + (rand() * 2 - 1) * 0.06;
      const modalPrice = roundTo(latest.modalPrice * offset, anchor.unit);

      const bandRand = mulberry32(
        hashString(`${hub.id}|${commodity}|${market}|band`),
      );
      const band = bandRand() * 0.08 + 0.02;

      return {
        market,
        district: null,
        state: hub.state,
        commodity: findCommodity(commodity)?.name ?? commodity,
        variety: null,
        grade: null,
        minPrice: roundTo(modalPrice * (1 - band), anchor.unit),
        maxPrice: roundTo(modalPrice * (1 + band), anchor.unit),
        modalPrice,
        unitOfSale: anchor.unit,
        currency: 'INR' as const,
        arrivalDate: latest.arrivalDate,
      };
    });
  }

  /** The generated daily series for a hub + commodity, oldest point first. */
  async fetchHistory(
    hub: MandiHub,
    commodity: string,
  ): Promise<TrendPoint[]> {
    return this.fetchSeriesSync(hub, commodity);
  }

  /**
   * Build the series.
   *
   * A mean-reverting walk rather than white noise: each day's move is seeded
   * from that specific date, then pulled back toward the commodity's anchor.
   * Pure per-day noise would give a jagged line with no memory, which reads as
   * obviously fake; a walk that drifts and recovers looks like a market.
   */
  private fetchSeriesSync(hub: MandiHub, commodity: string): TrendPoint[] {
    const anchor = findCommodity(commodity) ?? FALLBACK_ANCHOR;
    const points: TrendPoint[] = [];

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);

    let price = anchor.basePrice;

    for (let offset = SERIES_DAYS - 1; offset >= 0; offset -= 1) {
      const date = new Date(today);
      date.setUTCDate(date.getUTCDate() - offset);
      const iso = date.toISOString().slice(0, 10);

      const rand = mulberry32(hashString(`${hub.id}|${commodity}|${iso}`));

      const shock = (rand() * 2 - 1) * anchor.volatility * 0.5;
      const reversion =
        ((anchor.basePrice - price) / anchor.basePrice) * 0.15;

      price = price * (1 + shock + reversion);

      points.push({
        arrivalDate: iso,
        modalPrice: roundTo(price, anchor.unit),
        // Number of boards the day's average came from — kept inside the same
        // generated world so the figure is at least self-consistent.
        dataPoints: 8 + Math.floor(rand() * 12),
      });
    }

    return points;
  }
}

/**
 * Round to a step sensible for the unit.
 *
 * A saffron price per kilogram and an onion price per quintal are three orders
 * of magnitude apart, and rounding both to the nearest rupee would give the
 * saffron card eight digits of obviously-made-up precision.
 */
function roundTo(value: number, unit: PriceUnit): number {
  const step = unit === 'kg' ? 10 : 5;
  return Math.round(value / step) * step;
}

/** Commodity names the simulated provider can anchor precisely. */
export const SIMULATED_COMMODITIES = MANDI_COMMODITIES.map((c) => c.name);
