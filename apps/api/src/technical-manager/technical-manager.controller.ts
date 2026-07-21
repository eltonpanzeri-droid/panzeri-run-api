import { Body, Controller, Delete, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { TechnicalManagerAgentService } from './technical-manager-agent.service';
import { SendChatMessageDto } from './dto/send-chat-message.dto';

@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/students/:studentId/technical-manager')
export class TechnicalManagerController {
  constructor(private readonly agent: TechnicalManagerAgentService) {}

  @Get('chat')
  history(@Param('studentId') studentId: string) {
    return this.agent.history(studentId);
  }

  @Post('chat')
  chat(@Param('studentId') studentId: string, @Body() dto: SendChatMessageDto) {
    return this.agent.chat(studentId, dto.message);
  }

  @Get('directives')
  directives(@Param('studentId') studentId: string) {
    return this.agent.directives(studentId);
  }

  @Delete('directives/:directiveId')
  deactivateDirective(@Param('studentId') studentId: string, @Param('directiveId') directiveId: string) {
    return this.agent.deactivateDirective(studentId, directiveId);
  }
}
