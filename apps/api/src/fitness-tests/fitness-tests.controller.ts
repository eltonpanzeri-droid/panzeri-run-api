import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { CreateThreeKmTestDto } from './dto/create-three-km-test.dto';
import { FitnessTestsService } from './fitness-tests.service';

@UseGuards(AuthGuard('jwt'))
@Controller('fitness-tests')
export class FitnessTestsController {
  constructor(private readonly fitnessTestsService: FitnessTestsService) {}

  @Post('3km')
  createThreeKm(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateThreeKmTestDto) {
    return this.fitnessTestsService.createThreeKm(user.sub, dto);
  }

  @Get()
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.fitnessTestsService.list(user.sub);
  }
}
