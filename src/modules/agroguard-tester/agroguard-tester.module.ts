import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AgroGuardTesterController } from './agroguard-tester.controller';
import { AgroGuardTesterService } from './agroguard-tester.service';

@Module({
  imports: [PrismaModule],
  controllers: [AgroGuardTesterController],
  providers: [AgroGuardTesterService],
  exports: [AgroGuardTesterService],
})
export class AgroGuardTesterModule {}
