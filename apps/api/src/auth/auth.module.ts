import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtStrategy } from './jwt.strategy';
import { MetaCapiService } from '../meta/meta-capi.service';
import { EmailService } from '../messaging/email.service';
import { TelegramService } from '../billing/telegram.service';

@Module({
  imports: [PassportModule, JwtModule.register({})],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy, MetaCapiService, EmailService, TelegramService],
  exports: [AuthService],
})
export class AuthModule {}
