import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';

@Injectable()
export class ListingsSearchService {
  constructor(private readonly prisma: PrismaService) {}

  async search(query: {
    region?: string;
    category?: string;
    minPrice?: number;
    maxPrice?: number;
    organic?: boolean;
    page?: number;
  }) {
    const where: any = { status: 'ACTIVE' };
    if (query.region)   where.originRegionId = query.region;
    if (query.category) where.categoryId     = query.category;
    if (query.minPrice || query.maxPrice) {
      where.pricePerUnit = {};
      if (query.minPrice) where.pricePerUnit.gte = query.minPrice;
      if (query.maxPrice) where.pricePerUnit.lte = query.maxPrice;
    }

    return this.prisma.listing.findMany({
      where,
      include: { farmerProfile: true, category: true, originRegion: true },
      take: 20,
      skip: (query.page ?? 0) * 20,
      orderBy: { createdAt: 'desc' },
    });
  }
}