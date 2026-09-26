import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException, BadRequestException } from '@nestjs/common';
import { OrderStatus, TradeDirection } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: PrismaService;

  // Create a mock object to simulate the database
  const mockPrismaService = {
    listing: { findUnique: jest.fn(), update: jest.fn() },
    order: { findUnique: jest.fn(), create: jest.fn() },
    appointment: { findUnique: jest.fn() },
    buyerProfile: { findUnique: jest.fn() },
    address: { findFirst: jest.fn() },
    shippingCapability: { findUnique: jest.fn() },
    $transaction: jest.fn(), // <-- ADDED TRANSACTION MOCK
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: PrismaService, useValue: mockPrismaService },
      ],
    }).compile();

    service = module.get<OrdersService>(OrdersService);
    prisma = module.get<PrismaService>(PrismaService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should calculate total correctly', () => {
    expect(service.calculateTotal([100, 200, 50])).toBe(350);
  });

  describe('createOrder', () => {
    it('should throw BadRequestException if appointment is not completed', async () => {
      mockPrismaService.appointment.findUnique.mockResolvedValue({ id: 'app-1', status: 'SCHEDULED' });

      await expect(
        service.createOrder('buyer-1', 'listing-1', 10, 'app-1', 'fee-1')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw NotFoundException if listing does not exist', async () => {
      mockPrismaService.appointment.findUnique.mockResolvedValue({ id: 'app-1', status: 'COMPLETED' });
      mockPrismaService.listing.findUnique.mockResolvedValue(null);

      await expect(
        service.createOrder('buyer-1', 'invalid-listing', 10, 'app-1', 'fee-1')
      ).rejects.toThrow(NotFoundException);
    });

    it('should throw BadRequestException if requested quantity exceeds stock', async () => {
      mockPrismaService.appointment.findUnique.mockResolvedValue({ id: 'app-1', status: 'COMPLETED' });
      mockPrismaService.listing.findUnique.mockResolvedValue({ 
        id: 'listing-1', 
        stock: 5 
      });

      await expect(
        service.createOrder('buyer-1', 'listing-1', 10, 'app-1', 'fee-1')
      ).rejects.toThrow(BadRequestException);
    });

    it('should throw BadRequestException if shipping route is unsupported', async () => {
      mockPrismaService.appointment.findUnique.mockResolvedValue({ id: 'app-1', status: 'COMPLETED' });
      mockPrismaService.listing.findUnique.mockResolvedValue({ id: 'listing-1', stock: 50, farmerProfileId: 'farmer-1' });
      
      mockPrismaService.buyerProfile.findUnique.mockResolvedValue({ id: 'buyer-1', userId: 'user-1' });
      mockPrismaService.address.findFirst.mockResolvedValue({ regionId: 'region-dest' });
      
      // Simulate unsupported trade route
      mockPrismaService.shippingCapability.findUnique.mockResolvedValue({ supported: false });

      await expect(
        service.createOrder('buyer-1', 'listing-1', 10, 'app-1', 'fee-1')
      ).rejects.toThrow(BadRequestException);
    });

    it('should create an order successfully with calculated totals and inventory lock', async () => {
      mockPrismaService.appointment.findUnique.mockResolvedValue({ id: 'app-1', status: 'COMPLETED' });
      
      const mockListing = {
        id: 'listing-1',
        pricePerUnit: 100,
        currency: 'USD',
        farmerProfileId: 'farmer-1',
        stock: 50,
      };
      mockPrismaService.listing.findUnique.mockResolvedValue(mockListing);
      
      mockPrismaService.buyerProfile.findUnique.mockResolvedValue({ id: 'buyer-1', userId: 'user-1' });
      mockPrismaService.address.findFirst.mockResolvedValue({ regionId: 'region-dest' });
      mockPrismaService.shippingCapability.findUnique.mockResolvedValue({ supported: true });
      
      const expectedOrder = { id: 'order-1', subtotal: 1000 };
      const expectedListingUpdate = { id: 'listing-1', stock: 40 };
      
      // Simulate the array returned by the $transaction
      mockPrismaService.$transaction.mockResolvedValue([expectedOrder, expectedListingUpdate]);

      const result = await service.createOrder('buyer-1', 'listing-1', 10, 'app-1', 'fee-1');

      expect(result).toEqual(expectedOrder);
    });
  });

  describe('loadOrder', () => {
    it('should throw NotFoundException if order does not exist', async () => {
      mockPrismaService.order.findUnique.mockResolvedValue(null);
      await expect(service.loadOrder('non-existent-id')).rejects.toThrow(NotFoundException);
    });

    it('should return the order when found', async () => {
      const mockOrder = { id: 'order-123', status: OrderStatus.PLACED };
      mockPrismaService.order.findUnique.mockResolvedValue(mockOrder);

      const result = await service.loadOrder('order-123');

      expect(result).toEqual(mockOrder);
    });
  });
});