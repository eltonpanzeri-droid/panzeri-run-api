import { Body, Controller, Get, Headers, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { BillingService } from './billing.service';
import { ApplyCouponDto } from './dto/apply-coupon.dto';
import { CreateCheckoutDto } from './dto/create-checkout.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getMine(@CurrentUser() user: CurrentUserPayload) { return this.billingService.getMine(user.sub); }

  @UseGuards(AuthGuard('jwt'))
  @Post('checkout')
  createCheckout(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateCheckoutDto) {
    return this.billingService.createCheckout(user.sub, dto.cpf);
  }

  @UseGuards(AuthGuard('jwt'))
  @Post('cancel')
  cancel(@CurrentUser() user: CurrentUserPayload) { return this.billingService.cancel(user.sub); }

  @UseGuards(AuthGuard('jwt'))
  @Post('coupon')
  applyCoupon(@CurrentUser() user: CurrentUserPayload, @Body() dto: ApplyCouponDto) {
    return this.billingService.applyCoupon(user.sub, dto.code);
  }

  @Post('asaas/webhook')
  asaasWebhook(@Headers('asaas-access-token') accessToken: string | undefined, @Body() payload: Record<string, any>) {
    return this.billingService.processAsaasWebhook(accessToken, payload);
  }
}

