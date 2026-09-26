import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AdvisoryController } from './advisory.controller';
import { AdvisoryAdminController } from './advisory-admin.controller';
import { AdvisoryService } from './advisory.service';

@Module({
  imports: [PrismaModule],
  controllers: [AdvisoryController, AdvisoryAdminController],
  providers: [AdvisoryService],
  exports: [AdvisoryService],
})
export class AdvisoryModule {}
