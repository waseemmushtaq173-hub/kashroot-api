import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /** Soft-delete helper: marks user as DELETED and pseudonymises PII. */
  async pseudonymiseUser(userId: string): Promise<void> {
    await this.$transaction([
      this.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${userId}@kashroot.invalid`,
          phone: null,
          status: 'DELETED',
          passwordHash: 'REDACTED',
          mfaSecret: null,
        },
      }),
      // Financial records (orders, payouts, payments) are RETAINED for 7 years
      // per Indian GST / income-tax obligations. Only PII fields are wiped.
    ]);
  }
}
