import { Body, Controller, Get, Header, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { SelfAccountDeletionService } from './self-account-deletion.service';
import { DataExportService } from './data-export.service';

// Exclusao de conta pelo proprio aluno. O usuario vem SEMPRE do JWT (nunca do corpo/URL): nao ha como excluir a conta de outra pessoa por aqui.
@Controller('me/account')
@UseGuards(AuthGuard('jwt'))
export class SelfAccountDeletionController {
  constructor(private readonly service: SelfAccountDeletionService, private readonly dataExport: DataExportService) {}

  // Exportacao dos proprios dados (LGPD/portabilidade). Id sempre do token; sem segredos; baixa como arquivo JSON.
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Get('data-export')
  @Header('Content-Type', 'application/json; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="meus-dados-panzeri-run.json"')
  async exportData(@CurrentUser() user: CurrentUserPayload) {
    return JSON.stringify(await this.dataExport.build(user.sub), null, 1);
  }

  @Get('deletion-info')
  info(@CurrentUser() user: CurrentUserPayload) {
    return this.service.info(user.sub);
  }

  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @HttpCode(200)
  @Post('delete')
  delete(@CurrentUser() user: CurrentUserPayload, @Body() body: { password?: string; confirmText?: string; externalCharges?: string; chargesAcknowledged?: boolean }) {
    return this.service.deleteOwnAccount(user.sub, body);
  }
}
