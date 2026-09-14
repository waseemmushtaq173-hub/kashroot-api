import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { TradeDirectionService, TradeDirection } from '../orders/trade-direction.service';

/**
 * AnalyticsService
 *
 * All KPIs are parameterized by reportingRegionId.
 * Do NOT hardcode any specific region name.
 *
 * Uses TradeDirectionService.getTradeDirection(order, reportingRegionId)
 * to classify each order as EXPORT_FROM, IMPORT_TO, or DOMESTIC_OTHER
 * from the perspective of the reporting region.
 *
 * KPIs surfaced:
 *   1. GMV (Gross Merchandise Value) by region
 *   2. Active farmers & buyers by region
 *   3. Import vs export volume ratio (order count + GMV split)
 *   4. Appointment show-up rate (uses Module 3 no-show tracking)
 *   5. Average dispute resolution time
 */
@Injectable()
export class AnalyticsService {
  private readonly logger = new Logger(AnalyticsService.name);

  constructor(
    private readonly prisma:                PrismaService,
    private readonly tradeDirectionService: TradeDirectionService,
  ) {}

  // ─── 1. GMV by Region ──────────────────────────────────────────────────────

  /**
   * getGmv
   * Returns total order value for COMPLETED orders where the reporting region
   * is the origin (EXPORT_FROM) or destination (IMPORT_TO).
   * Also returns a breakdown by currency.
   *
   * @param reportingRegionId - The region from whose perspective to report
   * @param from / to          - Optional date range filter (ISO-8601)
   */
  async getGmv(reportingRegionId: string, from?: string, to?: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        status:     { in: ['COMPLETED', 'DELIVERED'] },
        ...(from || to ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
        OR: [
          { originRegionId:      reportingRegionId },
          { destinationRegionId: reportingRegionId },
        ],
      },
      select: {
        id:                   true,
        totalAmount:          true,
        currency:             true,
        originRegionId:       true,
        destinationRegionId:  true,
      },
    });

    const gmvByCurrency: Record<string, number> = {};
    let   exportGmv = 0;
    let   importGmv = 0;

    for (const order of orders) {
      const direction = this.tradeDirectionService.getTradeDirection(
        order as any,
        reportingRegionId,
      );

      gmvByCurrency[order.currency] = (gmvByCurrency[order.currency] ?? 0) + order.totalAmount;

      if (direction === TradeDirection.EXPORT_FROM) exportGmv += order.totalAmount;
      if (direction === TradeDirection.IMPORT_TO)   importGmv += order.totalAmount;
    }

    return {
      reportingRegionId,
      totalOrderCount: orders.length,
      gmvByCurrency,
      exportGmv,
      importGmv,
    };
  }

  // ─── 2. Active Farmers & Buyers ───────────────────────────────────────────────

  /**
   * getActiveUsersByRegion
   * "Active" = completed at least one order or appointment in the given window.
   */
  async getActiveUsersByRegion(regionId: string, from?: string, to?: string) {
    const dateFilter = from || to ? {
      createdAt: {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to)   } : {}),
      },
    } : {};

    const [activeFarmerIds, activeBuyerIds] = await Promise.all([
      // Farmers who had an order originating from this region
      this.prisma.order.findMany({
        where:  { originRegionId: regionId, status: { in: ['COMPLETED', 'DELIVERED'] }, ...dateFilter },
        select: { farmerProfileId: true },
        distinct: ['farmerProfileId'],
      }),
      // Buyers who had an order touching this region
      this.prisma.order.findMany({
        where:  {
          status: { in: ['COMPLETED', 'DELIVERED'] },
          OR: [{ originRegionId: regionId }, { destinationRegionId: regionId }],
          ...dateFilter,
        },
        select: { buyerProfileId: true },
        distinct: ['buyerProfileId'],
      }),
    ]);

    return {
      regionId,
      activeFarmerCount: activeFarmerIds.length,
      activeBuyerCount:  activeBuyerIds.length,
    };
  }

  // ─── 3. Import vs Export Volume Ratio ────────────────────────────────────────

  async getTradeVolumeRatio(reportingRegionId: string, from?: string, to?: string) {
    const orders = await this.prisma.order.findMany({
      where: {
        status: { in: ['COMPLETED', 'DELIVERED'] },
        OR: [
          { originRegionId:      reportingRegionId },
          { destinationRegionId: reportingRegionId },
        ],
        ...(from || to ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      select: {
        totalAmount:         true,
        originRegionId:      true,
        destinationRegionId: true,
      },
    });

    let exportCount = 0, importCount = 0, domesticCount = 0;
    let exportValue = 0, importValue = 0;

    for (const order of orders) {
      const dir = this.tradeDirectionService.getTradeDirection(order as any, reportingRegionId);
      if (dir === TradeDirection.EXPORT_FROM) { exportCount++;  exportValue  += order.totalAmount; }
      if (dir === TradeDirection.IMPORT_TO)   { importCount++;  importValue  += order.totalAmount; }
      if (dir === TradeDirection.DOMESTIC_OTHER) domesticCount++;
    }

    const total = exportCount + importCount + domesticCount;
    return {
      reportingRegionId,
      exportCount,  exportValue,  exportPct:  total ? (exportCount  / total) * 100 : 0,
      importCount,  importValue,  importPct:  total ? (importCount  / total) * 100 : 0,
      domesticCount,              domesticPct: total ? (domesticCount / total) * 100 : 0,
      ratio: importCount > 0 ? (exportCount / importCount) : null,
    };
  }

  // ─── 4. Appointment Show-Up Rate ─────────────────────────────────────────────

  /**
   * getAppointmentShowUpRate
   * Uses Module 3\'s no-show tracking:
   *   - no_show_flagged = true: buyer or farmer was flagged absent
   *   - status = COMPLETED: appointment ran successfully
   *   - status = NO_SHOW: appointment failed (both absent or unresolved)
   *
   * Scoped to farmer\'s region (origin region = operational region).
   */
  async getAppointmentShowUpRate(regionId: string, from?: string, to?: string) {
    const appts = await this.prisma.appointment.findMany({
      where: {
        originRegionId: regionId,
        status:         { in: ['COMPLETED', 'NO_SHOW', 'CONFIRMED'] },
        ...(from || to ? {
          scheduledAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      select: { status: true, noShowFlagged: true },
    });

    const total     = appts.length;
    const completed = appts.filter(a => a.status === 'COMPLETED').length;
    const noShows   = appts.filter(a => a.status === 'NO_SHOW' || a.noShowFlagged).length;

    return {
      regionId,
      total,
      completed,
      noShows,
      showUpRate:  total > 0 ? (completed / total) * 100 : null,
      noShowRate:  total > 0 ? (noShows   / total) * 100 : null,
    };
  }

  // ─── 5. Average Dispute Resolution Time ─────────────────────────────────────

  /**
   * getAvgDisputeResolutionTime
   * Returns average time (in hours) from dispute creation to resolution.
   * Scoped to operational_region_id for REGIONAL_ADMIN.
   * Pass regionId = null for PLATFORM_ADMIN (global).
   */
  async getAvgDisputeResolutionTime(regionId: string | null, from?: string, to?: string) {
    const disputes = await this.prisma.dispute.findMany({
      where: {
        status:    'RESOLVED',
        resolvedAt: { not: null },
        ...(regionId ? { operationalRegionId: regionId } : {}),
        ...(from || to ? {
          createdAt: {
            ...(from ? { gte: new Date(from) } : {}),
            ...(to   ? { lte: new Date(to)   } : {}),
          },
        } : {}),
      },
      select: { createdAt: true, resolvedAt: true },
    });

    if (!disputes.length) {
      return { regionId, sampleSize: 0, avgResolutionHours: null };
    }

    const totalMs = disputes.reduce((acc, d) => {
      return acc + (d.resolvedAt!.getTime() - d.createdAt.getTime());
    }, 0);

    const avgMs    = totalMs / disputes.length;
    const avgHours = avgMs / (1000 * 60 * 60);

    return {
      regionId,
      sampleSize:          disputes.length,
      avgResolutionHours:  Math.round(avgHours * 10) / 10, // 1 decimal
    };
  }

  // ─── Composite Dashboard ────────────────────────────────────────────────────────

  /**
   * getDashboard
   * Aggregates all KPIs in parallel for a single region + date range.
   */
  async getDashboard(reportingRegionId: string, from?: string, to?: string) {
    const [gmv, users, trade, appointments, disputes] = await Promise.all([
      this.getGmv(reportingRegionId, from, to),
      this.getActiveUsersByRegion(reportingRegionId, from, to),
      this.getTradeVolumeRatio(reportingRegionId, from, to),
      this.getAppointmentShowUpRate(reportingRegionId, from, to),
      this.getAvgDisputeResolutionTime(reportingRegionId, from, to),
    ]);

    return { reportingRegionId, from, to, gmv, users, trade, appointments, disputes };
  }
}
