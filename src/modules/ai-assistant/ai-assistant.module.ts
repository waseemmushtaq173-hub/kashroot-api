import { Module } from '@nestjs/common';

import { PrismaModule } from '../../prisma/prisma.module';
import { AdvisoryModule } from '../advisory/advisory.module';
import { AiAssistantController } from './ai-assistant.controller';
import { AiAssistantService } from './ai-assistant.service';

@Module({
  imports: [PrismaModule, AdvisoryModule],
  controllers: [AiAssistantController],
  providers: [AiAssistantService],
  exports: [AiAssistantService],
})
export class AiAssistantModule {}
