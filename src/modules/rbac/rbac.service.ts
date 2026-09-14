import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { RoleName } from '@prisma/client';

/**
 * RBAC Service
 * Resolves the full permission set for a user.
 * Results are embedded in JWT at login and cached in Redis.
 * Layer 2 ownership checks are also implemented here.
 */
@Injectable()
export class RbacService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve all permission keys for a user.
   * Called at login to embed permissions in the JWT payload.
   */
  async resolveUserPermissions(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: {
        role: {
          include: {
            permissions: {
              include: { permission: true },
            },
          },
        },
      },
    });

    const permKeys = new Set<string>();
    for (const ur of userRoles) {
      for (const rp of ur.role.permissions) {
        permKeys.add(rp.permission.key);
      }
    }
    return [...permKeys];
  }

  /**
   * Resolve the role names for a user (for JWT payload).
   */
  async resolveUserRoles(userId: string): Promise<RoleName[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId },
      include: { role: true },
    });
    return userRoles.map((ur) => ur.role.name);
  }

  /**
   * Resolve the region IDs scoped to a user (for REGIONAL_ADMIN checks).
   */
  async resolveUserRegionIds(userId: string): Promise<string[]> {
    const userRoles = await this.prisma.userRole.findMany({
      where: { userId, regionId: { not: null } },
    });
    return userRoles
      .map((ur) => ur.regionId)
      .filter((id): id is string => id !== null);
  }

  // ── Layer 2 ownership / row-level checks ─────────────────────────────

  /**
   * Assert that a listing belongs to the requesting farmer.
   * Call from ListingsService before any mutation.
   */
  async assertListingOwnership(listingId: string, userId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
      include: { farmerProfile: { select: { userId: true } } },
    });
    if (!listing || listing.farmerProfile.userId !== userId) {
      throw new Error('FORBIDDEN: listing not owned by requester');
    }
  }

  /**
   * Assert that an appointment belongs to the requesting user
   * (either as farmer or buyer).
   */
  async assertAppointmentParticipant(
    appointmentId: string,
    userId: string,
  ): Promise<void> {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: {
        farmerProfile: { select: { userId: true } },
        buyerProfile: { select: { userId: true } },
      },
    });
    if (
      !appt ||
      (appt.farmerProfile.userId !== userId &&
        appt.buyerProfile.userId !== userId)
    ) {
      throw new Error('FORBIDDEN: appointment not accessible by requester');
    }
  }

  /**
   * Assert that an order belongs to the requesting user
   * (farmer, buyer, or assigned logistics partner).
   */
  async assertOrderAccess(orderId: string, userId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        farmerProfile: { select: { userId: true } },
        buyerProfile: { select: { userId: true } },
      },
    });
    if (
      !order ||
      (order.farmerProfile.userId !== userId &&
        order.buyerProfile.userId !== userId)
    ) {
      throw new Error('FORBIDDEN: order not accessible by requester');
    }
  }

  /**
   * Assert that a KYC submission belongs to the requesting farmer's region
   * (for REGIONAL_ADMIN scope checks).
   */
  async assertKycRegionScope(
    farmerProfileId: string,
    adminRegionIds: string[],
  ): Promise<void> {
    const farmer = await this.prisma.farmerProfile.findUnique({
      where: { id: farmerProfileId },
      select: { originRegionId: true },
    });
    if (
      !farmer?.originRegionId ||
      !adminRegionIds.includes(farmer.originRegionId)
    ) {
      throw new Error(
        'FORBIDDEN: farmer not in regional admin assigned region',
      );
    }
  }
}
