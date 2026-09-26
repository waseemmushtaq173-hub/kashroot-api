import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException, BadRequestException } from '@nestjs/common';
import { EscrowStatus } from '@prisma/client';

import { EscrowService } from './escrow.service';
import { LedgerService } from '../orders/ledger.service';
import { PrismaService } from '../../prisma/prisma.service';

describe('EscrowService', () => {
  let service: EscrowService;

  const mockPrisma = {
    order: { findUnique: jest.fn() },
    escrowHold: {
      findUnique: jest.fn(),
      create: jest.fn(),
      updateMany: jest.fn(),
    },
    // Run the callback against this same mock so tx.escrowHold === mockPrisma.escrowHold.
    $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(mockPrisma)),
  };

  const mockLedger = { createEntry: jest.fn(), queryByOrder: jest.fn() };

  const ORDER_ID = 'order-1';
  const baseOrder = {
    id: ORDER_ID,
    buyerProfileId: 'buyer-1',
    farmerProfileId: 'farmer-1',
    total: 1450,
    currency: 'INR',
    status: 'PLACED',
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EscrowService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: LedgerService, useValue: mockLedger },
      ],
    }).compile();

    service = module.get<EscrowService>(EscrowService);
  });

  afterEach(() => jest.clearAllMocks());

  describe('holdPaymentForOrder', () => {
    it('creates a HELD hold and a buyer DEBIT ledger entry', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(baseOrder);
      mockPrisma.escrowHold.findUnique.mockResolvedValue(null); // no prior hold
      mockPrisma.escrowHold.create.mockResolvedValue({ id: 'hold-1', status: EscrowStatus.HELD });

      await service.holdPaymentForOrder(ORDER_ID);

      expect(mockPrisma.escrowHold.create).toHaveBeenCalledTimes(1);
      expect(mockLedger.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          entryType: 'DEBIT',
          buyerProfileId: 'buyer-1',
          farmerProfileId: null,
          amount: 1450,
          relatedOrderId: ORDER_ID,
        }),
        expect.anything(),
      );
    });

    it('rejects a second hold for the same order', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(baseOrder);
      mockPrisma.escrowHold.findUnique.mockResolvedValue({ id: 'hold-1', status: EscrowStatus.HELD });

      await expect(service.holdPaymentForOrder(ORDER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.escrowHold.create).not.toHaveBeenCalled();
    });

    it('throws NotFound when the order does not exist', async () => {
      mockPrisma.order.findUnique.mockResolvedValue(null);
      await expect(service.holdPaymentForOrder(ORDER_ID)).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('releaseEscrowToProvider', () => {
    it('releases a HELD hold and credits the provider once the order is delivered', async () => {
      const heldHold = {
        id: 'hold-1',
        orderId: ORDER_ID,
        status: EscrowStatus.HELD,
        farmerProfileId: 'farmer-1',
        buyerProfileId: 'buyer-1',
        amount: 1450,
        currency: 'INR',
      };
      mockPrisma.escrowHold.findUnique
        .mockResolvedValueOnce(heldHold) // requireHold
        .mockResolvedValueOnce({ ...heldHold, status: EscrowStatus.RELEASED }); // post-update read
      mockPrisma.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'DELIVERED' });
      mockPrisma.escrowHold.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.releaseEscrowToProvider(ORDER_ID);

      expect(mockPrisma.escrowHold.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'hold-1', status: EscrowStatus.HELD },
          data: expect.objectContaining({ status: EscrowStatus.RELEASED }),
        }),
      );
      expect(mockLedger.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({ entryType: 'CREDIT', farmerProfileId: 'farmer-1', buyerProfileId: null }),
        expect.anything(),
      );
      expect(result).toEqual(expect.objectContaining({ status: EscrowStatus.RELEASED }));
    });

    it('refuses to release a hold that is not HELD', async () => {
      mockPrisma.escrowHold.findUnique.mockResolvedValue({ id: 'hold-1', status: EscrowStatus.RELEASED });
      await expect(service.releaseEscrowToProvider(ORDER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.escrowHold.updateMany).not.toHaveBeenCalled();
    });

    it('refuses to release before the order is delivered/completed', async () => {
      mockPrisma.escrowHold.findUnique.mockResolvedValue({ id: 'hold-1', status: EscrowStatus.HELD });
      mockPrisma.order.findUnique.mockResolvedValue({ ...baseOrder, status: 'SHIPPED' });
      await expect(service.releaseEscrowToProvider(ORDER_ID)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('refundBuyer', () => {
    it('refunds a HELD hold and credits the buyer', async () => {
      const heldHold = {
        id: 'hold-1',
        orderId: ORDER_ID,
        status: EscrowStatus.HELD,
        farmerProfileId: 'farmer-1',
        buyerProfileId: 'buyer-1',
        amount: 1450,
        currency: 'INR',
      };
      mockPrisma.escrowHold.findUnique
        .mockResolvedValueOnce(heldHold)
        .mockResolvedValueOnce({ ...heldHold, status: EscrowStatus.REFUNDED });
      mockPrisma.escrowHold.updateMany.mockResolvedValue({ count: 1 });

      const result = await service.refundBuyer(ORDER_ID, { refundId: 'refund-1', reason: 'dispute' });

      expect(mockLedger.createEntry).toHaveBeenCalledWith(
        expect.objectContaining({
          entryType: 'CREDIT',
          buyerProfileId: 'buyer-1',
          farmerProfileId: null,
          relatedRefundId: 'refund-1',
        }),
        expect.anything(),
      );
      expect(result).toEqual(expect.objectContaining({ status: EscrowStatus.REFUNDED }));
    });

    it('refuses to refund a hold that is already released', async () => {
      mockPrisma.escrowHold.findUnique.mockResolvedValue({ id: 'hold-1', status: EscrowStatus.RELEASED });
      await expect(service.refundBuyer(ORDER_ID)).rejects.toBeInstanceOf(ConflictException);
      expect(mockPrisma.escrowHold.updateMany).not.toHaveBeenCalled();
    });
  });
});
