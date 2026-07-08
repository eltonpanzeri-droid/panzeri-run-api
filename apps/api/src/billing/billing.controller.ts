import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { BillingService } from './billing.service';
import { EfiNotificationDto } from './dto/efi-notification.dto';

@Controller('billing')
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @UseGuards(AuthGuard('jwt'))
  @Get('me')
  getMine(@CurrentUser() user: CurrentUserPayload) { return this.billingService.getMine(user.sub); }

  @UseGuards(AuthGuard('jwt'))
  @Post('checkout')
  createCheckout(@CurrentUser() user: CurrentUserPayload) { return this.billingService.createCheckout(user.sub); }

  @UseGuards(AuthGuard('jwt'))
  @Post('cancel')
  cancel(@CurrentUser() user: CurrentUserPayload) { return this.billingService.cancel(user.sub); }

  @Post('efi/notification')
  notification(@Body() dto: EfiNotificationDto) { return this.billingService.processNotification(dto.notification); }
}