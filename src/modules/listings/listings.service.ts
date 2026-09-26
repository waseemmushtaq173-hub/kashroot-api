import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class ListingsService {
  constructor(private readonly prisma: PrismaService) {}

  findAll(query: any) {
    return this.prisma.listing.findMany({
      where: { status: 'ACTIVE' },
      include: { farmerProfile: true, category: true },
      take: query.limit ? parseInt(query.limit) : 20,
      skip: query.page ? parseInt(query.page) * 20 : 0,
    });
  }

  findOne(id: string) {
    return this.prisma.listing.findUnique({
      where: { id },
      include: { farmerProfile: true, category: true },
    });
  }

  create(farmerProfileId: string, dto: any) {
    return this.prisma.listing.create({
      data: { ...dto, farmerProfileId, status: 'DRAFT' },
    });
  }

  update(id: string, dto: any) {
    return this.prisma.listing.update({
      where: { id },
      data: dto,
    });
  }

  remove(id: string) {
    return this.prisma.listing.update({
      where: { id },
      data: { status: 'ARCHIVED' },
    });
  }
}