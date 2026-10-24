import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ReviewAccountsSchedulerService } from './review-accounts-scheduler.service';

@Module({ imports: [PrismaModule], providers: [ReviewAccountsSchedulerService] })
export class AppReviewModule {}
