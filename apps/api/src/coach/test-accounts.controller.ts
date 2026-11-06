import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TestAccountsService } from './test-accounts.service';

// Cadastros de teste (05/11/2026): lista e marca/desmarca. Somente treinador/administrador.
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/test-accounts')
export class TestAccountsController {
  constructor(private readonly testAccounts: TestAccountsService) {}

  @Get()
  list() {
    return this.testAccounts.list();
  }

  @Post(':studentId')
  set(@Param('studentId') studentId: string, @Body() body: { isTestAccount?: unknown } | null) {
    return this.testAccounts.set(studentId, body?.isTestAccount);
  }
}
