import { Body, Controller, Get, Headers, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { BillingService } from './billing.service';
import { ApplyCouponDto } from './dto/apply-coupon.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  // force=1: botao "Atualizar situacao" (aceita uma consulta a loja com intervalo menor que a leitura automatica).
  getMine(@CurrentUser() user: CurrentUserPayload, @Query('force') force?: string) { return this.billingService.getMine(user.sub, { force: force === '1' }); }

  // Historico de faturas do proprio aluno (pedido 16/08 — tela tipo "Historico de contas" da
  // Cemig, mes/valor/status). Mesma funcao usada pelo treinador em coach.controller.ts.
  @UseGuards(AuthGuard('jwt'))
  @Get('history')
  getHistory(@CurrentUser() user: CurrentUserPayload) { return this.billingService.paymentHistory(user.sub); }

  @UseGuards(AuthGuard('jwt'))
  @Post('checkout')
  createCheckout(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateCheckoutDto) {
    return this.billingService.createCheckout(user.sub, dto.cpf);
  }

  // Assinatura comprada/restaurada pela loja (Apple/Google): o app pede ao SERVIDOR que valide no RevenueCat. O usuario vem sempre do token.
  @UseGuards(AuthGuard('jwt'))
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @HttpCode(200)
  @Post('store/sync')
  // auto=1: consulta automatica do app (abrir/voltar ao primeiro plano) — so' recupera quem ja era assinante da loja, sem avisos de pagamento. Compra/restauracao nao enviam auto.
  syncStore(@CurrentUser() user: CurrentUserPayload, @Query('auto') auto?: string) {
    return auto === '1' ? this.billingService.syncStoreSubscription(user.sub, { automatic: true }) : this.billingService.syncStoreSubscription(user.sub);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('cancel')
  cancel(
    @CurrentUser() user: CurrentUserPayload,
    // 11/09: pesquisa de saída — campos opcionais, não bloqueiam o cancelamento se ausentes.
    @Body() body?: { reason?: string; feedbackText?: string; wouldReturn?: string },
  ) {
    return this.billingService.cancel(user.sub, body?.reason, body?.feedbackText, body?.wouldReturn);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('coupon')
  applyCoupon(@CurrentUser() user: CurrentUserPayload, @Body() dto: ApplyCouponDto) {
    return this.billingService.applyCoupon(user.sub, dto.code);
  }

  @SkipThrottle()
  @Post('asaas/webhook')
  asaasWebhook(@Headers('asaas-access-token') accessToken: string | undefined, @Body() payload: Record<string, any>) {
    return this.billingService.processAsaasWebhook(accessToken, payload);
  }

  // Assinatura comprada dentro do app nativo (Apple IAP / Google Play Billing) — o RevenueCat
  // manda esse aviso quando a compra/renovacao/cancelamento acontece de verdade nas lojas.
  @SkipThrottle()
  @Post('revenuecat/webhook')
  revenueCatWebhook(@Headers('authorization') authHeader: string | undefined, @Body() payload: Record<string, any>) {
    return this.billingService.processRevenueCatWebhook(authHeader, payload);
  }
}

