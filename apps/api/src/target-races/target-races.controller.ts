import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { CreateTargetRaceDto } from './dto/create-target-race.dto';
import { UpdateTargetRaceDto } from './dto/update-target-race.dto';
import { TargetRacesService } from './target-races.service';

@UseGuards(AuthGuard('jwt'))
@Controller('me/target-races')
export class TargetRacesController {
  constructor(private readonly targetRaces: TargetRacesService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.targetRaces.list(user.sub);
  }

  @Post()
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateTargetRaceDto) {
    return this.targetRaces.create(user.sub, dto);
  }

  @Patch(':raceId')
  update(@CurrentUser() user: CurrentUserPayload, @Param('raceId') raceId: string, @Body() dto: UpdateTargetRaceDto) {
    return this.targetRaces.update(user.sub, raceId, dto);
  }

  @Delete(':raceId')
  remove(@CurrentUser() user: CurrentUserPayload, @Param('raceId') raceId: string) {
    return this.targetRaces.remove(user.sub, raceId);
  }
}
