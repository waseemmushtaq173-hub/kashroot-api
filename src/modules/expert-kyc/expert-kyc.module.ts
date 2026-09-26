import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { ExpertKycController } from './expert-kyc.controller';
import { ExpertKycAdminController } from './expert-kyc-admin.controller';
import { ExpertKycService } from './expert-kyc.service';

@Module({
  imports: [PrismaModule],
  controllers: [ExpertKycController, ExpertKycAdminController],
  providers: [ExpertKycService],
  exports: [ExpertKycService],
})
export class ExpertKycModule {}
