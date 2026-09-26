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
  // WRITE — createEntry() is the ONLY write surface
  // ───────────────────────────────────────────────────────────────

  /**
   * createEntry
   *
   * Inserts a new ledger entry. This is the ONLY write method on LedgerService —
   * there is deliberately no update or delete surface (see note at the bottom).
   * Pass a transaction client (tx) when called inside a $transaction block (e.g.
   * from EscrowService), or omit it for a standalone append.
   *
   * To correct an erroneous entry: create a new offsetting entry (opposite
   * entryType, same amount) with a description explaining the reversal.
   */
  async createEntry(
    input: AppendLedgerEntryInput,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const client = tx ?? this.prisma;

    await client.ledgerEntry.create({
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

  /**
   * appendEntry — backward-compatible alias for {@link createEntry}.
   *
   * Kept for the original (tx-first) call signature used elsewhere. Delegates to
   * createEntry so there remains exactly one insert path and zero mutation paths.
   */
  async appendEntry(
    txOrPrisma: Prisma.TransactionClient | PrismaService | undefined,
    input: AppendLedgerEntryInput,
  ): Promise<void> {
    const tx = txOrPrisma && txOrPrisma !== this.prisma
      ? (txOrPrisma as Prisma.TransactionClient)
      : undefined;
    return this.createEntry(input, tx);
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
