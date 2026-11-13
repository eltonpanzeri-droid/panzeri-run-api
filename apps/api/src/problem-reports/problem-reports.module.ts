import { Module } from '@nestjs/common';
import { TelegramService } from '../billing/telegram.service';
import { ProblemReportsCoachController, ProblemReportsStudentController } from './problem-reports.controller';
import { ProblemReportsService } from './problem-reports.service';

// TelegramService e' stateless (so' ConfigService, global): entra como provider direto, sem importar o BillingModule.
@Module({
  controllers: [ProblemReportsStudentController, ProblemReportsCoachController],
  providers: [ProblemReportsService, TelegramService],
})
export class ProblemReportsModule {}
