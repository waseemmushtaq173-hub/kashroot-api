import { Module } from '@nestjs/common';
import { RbacService } from './rbac.service';
import { PrismaService } from '../../prisma/prisma.service';

@Module({
  providers: [RbacService, PrismaService],
  exports: [RbacService],
})
export class RbacModule {}
