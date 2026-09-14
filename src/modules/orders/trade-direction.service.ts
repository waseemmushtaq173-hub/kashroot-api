import { Injectable } from '@nestjs/common';

/**
 * TradeDirection — perspective-relative.
 *
 * NOT stored on the order. Derived per-request via getTradeDirection().
 * The same order can be EXPORT_FROM one region's dashboard and IMPORT_TO another's.
 */
export enum TradeDirection {
  /** The requesting region is the origin (they exported it). */
  EXPORT_FROM    = 'EXPORT_FROM',
  /** The requesting region is the destination (they imported it). */
  IMPORT_TO      = 'IMPORT_TO',
  /** Both origin and destination are in the requesting region (domestic). */
  DOMESTIC_OTHER = 'DOMESTIC_OTHER',
}

export interface OrderSnapshot {
  originRegionId:      string;
  destinationRegionId: string;
  isCrossBorder:       boolean;
}

/**
 * TradeDirectionService
 *
 * Two responsibilities:
 *   1. getTradeDirection(order, perspectiveRegionId)
 *      Derives EXPORT_FROM | IMPORT_TO | DOMESTIC_OTHER relative to whichever
 *      region's dashboard is requesting. Called at read time, never written to DB.
 *
 *   2. isCrossBorder(originRegionId, destinationRegionId)
 *      Derives whether the trade crosses a country boundary from country codes.
 *      This is a SEPARATE boolean from trade_direction — a domestic order is
 *      not cross-border regardless of which region's dashboard views it.
 *      Written to orders.is_cross_border at creation time (immutable after that).
 *
 * Region ID format convention:
 *   "<ISO-3166-1-alpha2>-<sub-region-code>" e.g. "IN-JK" (India, Jammu & Kashmir)
 *   Country code is extracted as the prefix before the first '-'.
 *
 * CUSTOMS_CLEARANCE status (in UpdateOrderStatusDto) is only valid when is_cross_border=true.
 */
@Injectable()
export class TradeDirectionService {

  /**
   * getTradeDirection
   *
   * @param order              - Order snapshot (originRegionId + destinationRegionId)
   * @param perspectiveRegionId- The region whose dashboard is asking (e.g. 'IN-JK')
   * @returns TradeDirection   - From that region's perspective
   *
   * Example:
   *   order: { originRegionId: 'IN-JK', destinationRegionId: 'AE-DU' }
   *   perspectiveRegionId: 'IN-JK'  →  EXPORT_FROM (we shipped it out)
   *   perspectiveRegionId: 'AE-DU'  →  IMPORT_TO   (we received it)
   *   perspectiveRegionId: 'IN-MH'  →  DOMESTIC_OTHER (third-party view — not part of this order)
   */
  getTradeDirection(
    order:                OrderSnapshot,
    perspectiveRegionId:  string,
  ): TradeDirection {
    const { originRegionId, destinationRegionId } = order;

    if (perspectiveRegionId === originRegionId) {
      return TradeDirection.EXPORT_FROM;
    }
    if (perspectiveRegionId === destinationRegionId) {
      return TradeDirection.IMPORT_TO;
    }
    return TradeDirection.DOMESTIC_OTHER;
  }

  /**
   * isCrossBorder
   *
   * Returns true if origin and destination are in DIFFERENT countries.
   * Derived from the country-code prefix of the region IDs (before the first '-').
   *
   * This is computed at order creation and stored as orders.is_cross_border.
   * It does NOT change as the order moves through statuses.
   *
   * is_cross_border is NOT the same as trade_direction — a domestic order
   * from IN-JK to IN-MH is NOT cross-border even though the regions differ.
   *
   * @param originRegionId       - e.g. 'IN-JK'
   * @param destinationRegionId  - e.g. 'AE-DU'
   * @returns boolean            - true if countries differ
   */
  isCrossBorder(
    originRegionId:      string,
    destinationRegionId: string,
  ): boolean {
    const originCountry      = this.extractCountryCode(originRegionId);
    const destinationCountry = this.extractCountryCode(destinationRegionId);
    return originCountry !== destinationCountry;
  }

  /**
   * getCountryCodes — utility for display/reporting
   */
  getCountryCodes(regionId: string): string {
    return this.extractCountryCode(regionId);
  }

  // ─── PRIVATE ────────────────────────────────────────────────────────────────

  private extractCountryCode(regionId: string): string {
    // Expects format: "CC-subregion" e.g. "IN-JK", "AE-DU", "US-NY"
    // Returns "IN", "AE", "US" etc.
    const dashIdx = regionId.indexOf('-');
    if (dashIdx === -1) return regionId.toUpperCase(); // fallback: treat whole string as country
    return regionId.substring(0, dashIdx).toUpperCase();
  }
}
