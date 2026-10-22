import { Controller, Get, NotFoundException, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { PrismaService } from '../prisma/prisma.service';
import { ProfilePhotoService } from './profile-photo.service';

// Treinador/admin LEEM a foto do aluno (somente leitura). Quem altera ou apaga e' so' o proprio aluno (rotas /me/photo).
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach')
export class ProfilePhotoCoachController {
  constructor(private readonly photos: ProfilePhotoService, private readonly prisma: PrismaService) {}

  @Get('students/:studentId/photo')
  async photo(@Param('studentId') studentId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!user) throw new NotFoundException('Aluno não encontrado.');
    return this.photos.get(studentId);
  }
}
