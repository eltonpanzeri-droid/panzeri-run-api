import { Module } from '@nestjs/common';
import { TelegramService } from '../billing/telegram.service';
import { TombstoneLedger } from './tombstone-ledger';

// Ledger de tombstones (05/10/2026). TelegramService e' stateless (so' ConfigService, global), por isso e'
// provido aqui direto — evita importar o BillingModule e criar ciclo com os modulos que apagam dados.
@Module({
  providers: [TelegramService, TombstoneLedger],
  exports: [TombstoneLedger],
})
export class TombstoneModule {}
