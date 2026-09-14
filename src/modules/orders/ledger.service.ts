import {
  Injectable,
  Logger,
  ForbiddenException,
} from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { Prisma } from '@prisma/client';

export type LedgerEntryType = 'CREDIT' | 'DEBIT';

export interface AppendLedgerEntryInput {
  farmerProfileId: string | null;
  buyerProfileId:  string | null;
  entryType:       LedgerEntryType;
  amount:          number;
  currency:        string;
  relatedOrderId:  string | null;
  relatedRefundId: string | null;
  description:     string;
}

/**
 * LedgerService — APPEND-ONLY
 *
 * ledger_entries is an append-only financial audit log.
 *
 * Immutability contract (enforced at service layer):
 *   - appendEntry() is the ONLY write method.
 *   - There is NO updateEntry() method.
 *   - There is NO deleteEntry() method.
 *   - Corrections MUST be new offsetting entries (e.g. a CREDIT to reverse a DEBIT).
 *
 * The DB table also enforces this:
 *   - No `updated_at` column exists.
 *   - No `deleted_at` column exists.
 *   - A DB-level trigger (optional, for extra safety) can reject UPDATE/DELETE.
 *
 * appendEntry() accepts an optional Prisma transaction client (tx) so it can
 * be called inside OrdersService.$transaction and PaymentsService.$transaction
 * without creating a nested transaction.
 *
 * READ methods (queryByOrder, queryByFarmer, queryByBuyer) are provided for
 * reporting. They return rows ordered by created_at ASC (chronological).
 */
@Injectable()
export class LedgerService {
  private readonly logger = new Logger(LedgerService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ───────────────────────────────────────────────────────────────
  // WRITE — appendEntry() is the ONLY write surface
  // ───────────────────────────────────────────────────────────────

  /**
   * appendEntry
   *
   * Appends a new ledger entry. This is the ONLY write method on LedgerService.
   * Call with a transaction client (tx) when inside a $transaction block,
   * or call without tx for standalone writes.
   *
   * To correct an erroneous entry: append a new offsetting entry.
   * Example: wrong DEBIT of 100 → append CREDIT of 100 with description='Correction: reversed DEBIT for order X'
   *
   * @param txOrPrisma - Prisma transaction client OR undefined (uses this.prisma)
   * @param input      - Ledger entry data
   */
  async appendEntry(
    txOrPrisma: Prisma.TransactionClient | PrismaService | undefined,
    input: AppendLedgerEntryInput,
  ): Promise<void> {
    const client = txOrPrisma ?? this.prisma;

    await (client as PrismaService).ledgerEntry.create({
      data: {
        farmerProfileId: input.farmerProfileId,
        buyerProfileId:  input.buyerProfileId,
        entryType:       input.entryType,
        amount:          input.amount,
        currency:        input.currency,
        relatedOrderId:  input.relatedOrderId,
        relatedRefundId: input.relatedRefundId,
        description:     input.description,
        // created_at is auto-set by DB default — NOT settable
      },
    });

    this.logger.log(
      `Ledger ${input.entryType} appended: ${input.amount} ${input.currency} | ` +
      `order=${input.relatedOrderId} refund=${input.relatedRefundId} | ${input.description}`,
    );
  }

  // ───────────────────────────────────────────────────────────────
  // READ
  // ───────────────────────────────────────────────────────────────

  async queryByOrder(orderId: string) {
    return this.prisma.ledgerEntry.findMany({
      where:   { relatedOrderId: orderId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async queryByFarmer(farmerProfileId: string) {
    return this.prisma.ledgerEntry.findMany({
      where:   { farmerProfileId },
      orderBy: { createdAt: 'asc' },
    });
  }

  async queryByBuyer(buyerProfileId: string) {
    return this.prisma.ledgerEntry.findMany({
      where:   { buyerProfileId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ───────────────────────────────────────────────────────────────
  // INTENTIONALLY ABSENT — documented for clarity
  // ───────────────────────────────────────────────────────────────

  // updateEntry()  ─ DOES NOT EXIST. Ledger entries are immutable.
  // deleteEntry()  ─ DOES NOT EXIST. Ledger entries are never deleted.
  //
  // If you need to correct an entry:
  //   1. Call appendEntry() with the OPPOSITE entryType for the same amount.
  //   2. Set description to clearly explain the correction:
  //      e.g. "Correction: reverses DEBIT entry <id> due to payment reversal for order <orderId>"
}
