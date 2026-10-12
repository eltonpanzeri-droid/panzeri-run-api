import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { TombstoneModule } from '../backup/tombstone.module';
import { PolarModule } from '../polar/polar.module';
import { WahooModule } from '../wahoo/wahoo.module';
import { AccountDeletionService } from './account-deletion.service';
import { SelfAccountDeletionService } from './self-account-deletion.service';
import { SelfAccountDeletionController } from './self-account-deletion.controller';
import { BillingModule } from '../billing/billing.module';

@Module({
  imports: [PrismaModule, TombstoneModule, PolarModule, WahooModule, BillingModule],
  controllers: [SelfAccountDeletionController],
  providers: [AccountDeletionService, SelfAccountDeletionService],
  exports: [AccountDeletionService],
})
export class AccountDeletionModule {}
