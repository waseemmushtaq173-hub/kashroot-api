import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AdvisoryController } from './advisory.controller';
import { AdvisoryAdminController } from './advisory-admin.controller';
import { AdvisoryService } from './advisory.service';
import { GovAdvisorySyncService } from './gov-advisory-sync.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdvisoryController, AdvisoryAdminController],
  providers: [AdvisoryService, GovAdvisorySyncService],
  exports: [AdvisoryService, GovAdvisorySyncService],
})
export class AdvisoryModule {}
