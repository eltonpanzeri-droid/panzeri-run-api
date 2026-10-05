import { forwardRef, Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { BackupService } from './backup.service';

@Module({
  // 04/09: BillingModule adicionado so' pelo TelegramService (aviso no Telegram quando o backup
  // falha) — forwardRef por seguranca, mesmo padrao ja usado em outros modulos que importam
  // BillingModule, caso surja um ciclo no futuro.
  // 05/10/2026: MessagingModule (Resend) saiu — o backup nao e mais enviado por e-mail.
  imports: [forwardRef(() => BillingModule)],
  providers: [BackupService],
  exports: [BackupService],
})
export class BackupModule {}
