import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { LedgerService } from '../orders/ledger.service';
import { EscrowController } from './escrow.controller';
import { EscrowService } from './escrow.service';

/**
 * EscrowModule bundles the vault (EscrowService) with the append-only
 * LedgerService (reused from the orders module — now wired live). LedgerService
 * is provided here so escrow state changes and their audit entries share one DI
 * scope and one transaction.
 */
@Module({
  imports: [PrismaModule],
  controllers: [EscrowController],
  providers: [EscrowService, LedgerService],
  exports: [EscrowService, LedgerService],
})
export class EscrowModule {}
