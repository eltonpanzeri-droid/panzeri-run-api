import { Body, Controller, Delete, Get, Param, Patch, Post, Put, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { ShoesService } from './shoes.service';
import { UpsertShoeDto } from './dto/upsert-shoe.dto';

// Meus Tenis (04/10/2026) — CRUD do aluno. Sem exclusao destrutiva (pedido explicito); "aposentar"
// e' a unica forma de tirar um par de circulacao, preservando historico.
@UseGuards(AuthGuard('jwt'))
@Controller('me/shoes')
export class ShoesController {
  constructor(private readonly shoes: ShoesService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.shoes.list(user.sub);
  }

  @Get('picker')
  listForPicker(@CurrentUser() user: CurrentUserPayload) {
    return this.shoes.listActiveForPicker(user.sub);
  }

  @Get(':shoeId')
  detail(@CurrentUser() user: CurrentUserPayload, @Param('shoeId') shoeId: string) {
    return this.shoes.detail(user.sub, shoeId);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: UpsertShoeDto) {
    return this.shoes.create(user.sub, dto);
  }

  @Patch(':shoeId')
  update(@CurrentUser() user: CurrentUserPayload, @Param('shoeId') shoeId: string, @Body() dto: UpsertShoeDto) {
    return this.shoes.update(user.sub, shoeId, dto);
  }

  @Post(':shoeId/reactivate')
  reactivate(@CurrentUser() user: CurrentUserPayload, @Param('shoeId') shoeId: string) {
    return this.shoes.reactivate(user.sub, shoeId);
  }

  @Get(':shoeId/photo')
  photo(@CurrentUser() user: CurrentUserPayload, @Param('shoeId') shoeId: string) {
    return this.shoes.getPhoto(user.sub, shoeId);
  }

  @Put(':shoeId/photo')
  setPhoto(@CurrentUser() user: CurrentUserPayload, @Param('shoeId') shoeId: string, @Body() body: { imageBase64?: unknown }) {
    return this.shoes.setPhoto(user.sub, shoeId, body?.imageBase64);
  }

  @Delete(':shoeId/photo')
  removePhoto(@CurrentUser() user: CurrentUserPayload, @Param('shoeId') shoeId: string) {
    return this.shoes.removePhoto(user.sub, shoeId);
  }

  @Post(':shoeId/retire')
  retire(@CurrentUser() user: CurrentUserPayload, @Param('shoeId') shoeId: string) {
    return this.shoes.retire(user.sub, shoeId);
  }
}
