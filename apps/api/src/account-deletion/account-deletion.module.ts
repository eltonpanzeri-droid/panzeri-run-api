import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TombstoneModule } from '../backup/tombstone.module';
import { PolarModule } from '../polar/polar.module';
import { AccountDeletionService } from './account-deletion.service';

@Module({
  imports: [PrismaModule, TombstoneModule, PolarModule],
  providers: [AccountDeletionService],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
