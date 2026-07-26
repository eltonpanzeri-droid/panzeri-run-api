import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { CreateObservationDto } from './dto/create-observation.dto';
import { ObservationsService } from './observations.service';

@UseGuards(AuthGuard('jwt'))
@Controller('me/observations')
export class ObservationsController {
  constructor(private readonly observations: ObservationsService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.observations.listMine(user.sub);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateObservationDto) {
    return this.observations.create(user.sub, dto);
  }
}
