import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
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
    // --- GATE 1: Appointment Trust-Gate ---
    const appointment = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
    });

    if (!appointment) {
      throw new NotFoundException(`Appointment with ID ${appointmentId} not found`);
    }

    if (appointment.status !== 'COMPLETED') {
      throw new BadRequestException('Orders can only be placed after an appointment is completed.');
    }

    // --- Fetch Listing ---
    const listing = await this.prisma.listing.findUnique({
      where: { id: listingId },
    });

    if (!listing) {
      throw new NotFoundException(`Listing with ID ${listingId} not found`);
    }

    // --- GATE 3: Inventory Check ---
    if (quantity > listing.stock) {
      throw new BadRequestException(`Requested quantity (${quantity}) exceeds available stock (${listing.stock}).`);
    }

    // --- GATE 2: Region-Pair Check (Shipping Capability) ---
    const buyer = await this.prisma.buyerProfile.findUnique({
      where: { id: buyerProfileId }
    });

    if (!buyer) throw new NotFoundException('Buyer profile not found.');

    const defaultAddress = await this.prisma.address.findFirst({
      where: { userId: buyer.userId, isDefault: true }
    });

    if (!defaultAddress || !defaultAddress.regionId) {
      throw new BadRequestException('Buyer must have a default address with a valid region to place an order.');
    }

    const capability = await this.prisma.shippingCapability.findUnique({
      where: {
        farmerProfileId_destinationRegionId: {
          farmerProfileId: listing.farmerProfileId,
          destinationRegionId: defaultAddress.regionId,
        }
      }
    });

    if (!capability || !capability.supported) {
      throw new BadRequestException('Trade route to your region is not enabled by this farmer.');
    }

    // --- Calculate Financials ---
    const unitPrice = Number(listing.pricePerUnit); 
    const subtotal = unitPrice * quantity;
    const serviceFee = subtotal * 0.05; 
    const total = subtotal + serviceFee;

    // --- Create Order ---
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