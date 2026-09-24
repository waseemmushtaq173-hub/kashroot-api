import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service'; 
import { OrderStatus, TradeDirection } from '@prisma/client';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  calculateTotal(amounts: number[]): number {
    return amounts.reduce((sum, current) => sum + current, 0);
  }

  async loadOrder(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
    });

    if (!order) {
      throw new NotFoundException(`Order with ID ${id} not found`);
    }

    return order;
  }

  async createOrder(
    buyerProfileId: string, 
    listingId: string, 
    quantity: number,
    appointmentId: string,
    feeConfigVersionId: string
  ) {
    // 1. Fetch the listing to get dynamic pricing and farmer association
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new NotFoundException(`Listing with ID ${listingId} not found`);
    }

    // 2. Calculate financial totals dynamically
    const unitPrice = Number(listing.pricePerUnit); 
    const subtotal = unitPrice * quantity;
    const serviceFee = subtotal * 0.05; // 5% KashRoot platform fee
    const total = subtotal + serviceFee;

    // 3. Create the order with real variables
    const order = await this.prisma.order.create({
      data: {
        status: OrderStatus.PLACED,
        quantity: quantity,
        
        buyerProfile: { connect: { id: buyerProfileId } },
        listing: { connect: { id: listingId } },
        
        farmerProfile: { connect: { id: listing.farmerProfileId } }, 
        
        appointment: { connect: { id: appointmentId } },             
        feeConfigVersion: { connect: { id: feeConfigVersionId } },   

        unitPrice: unitPrice,       
        currency: listing.currency, 
        subtotal: subtotal,        
        serviceFee: serviceFee,       
        total: total,           
        tradeDirection: TradeDirection.EXPORT_FROM_REGION 
      }
    });

    return order;
  }
}