import { Test, TestingModule } from '@nestjs/testing';
import { OrdersService } from './orders.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotFoundException } from '@nestjs/common';
import { OrderStatus, TradeDirection } from '@prisma/client';

describe('OrdersService', () => {
  let service: OrdersService;
  let prisma: PrismaService;

  // Create a mock object to simulate the database
  const mockPrismaService = {
    listing: { findUnique: jest.fn() },
    order: { findUnique: jest.fn(), create: jest.fn() },
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
    // Reset mocks after each test so they don't interfere with one another
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should calculate total correctly', () => {
    expect(service.calculateTotal([100, 200, 50])).toBe(350);
  });

  describe('createOrder', () => {
    it('should throw NotFoundException if listing does not exist', async () => {
      // Simulate the database returning null
      mockPrismaService.listing.findUnique.mockResolvedValue(null);

      await expect(
        service.createOrder('buyer-1', 'invalid-listing', 10, 'app-1', 'fee-1')
      ).rejects.toThrow(NotFoundException);
    });

    it('should create an order successfully with calculated totals', async () => {
      // Simulate a valid listing returned from the database
      const mockListing = {
        id: 'listing-1',
        pricePerUnit: 100,
        currency: 'USD',
        farmerProfileId: 'farmer-1',
      };
      
      mockPrismaService.listing.findUnique.mockResolvedValue(mockListing);
      
      // Simulate the created order returned by Prisma
      const expectedOrder = { id: 'order-1', subtotal: 1000 };
      mockPrismaService.order.create.mockResolvedValue(expectedOrder);

      const result = await service.createOrder('buyer-1', 'listing-1', 10, 'app-1', 'fee-1');

      // Verify the final output
      expect(result).toEqual(expectedOrder);
      
      // Verify the math calculations were passed to Prisma correctly
      expect(mockPrismaService.order.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            subtotal: 1000,
            serviceFee: 50,
            total: 1050,
            tradeDirection: TradeDirection.EXPORT_FROM_REGION,
          }),
        })
      );
    });
  });
});