import { forwardRef, Module } from '@nestjs/common';
import { MessagingModule } from '../messaging/messaging.module';
import { BillingModule } from '../billing/billing.module';
import { BackupService } from './backup.service';

@Module({
  // 04/09: BillingModule adicionado so' pelo TelegramService (aviso no Telegram quando o backup
  // falha) — forwardRef por seguranca, mesmo padrao ja usado em outros modulos que importam
  // BillingModule, caso surja um ciclo no futuro.
  imports: [MessagingModule, forwardRef(() => BillingModule)],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
