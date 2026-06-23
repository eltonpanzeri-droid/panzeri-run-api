import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validateAvailability } from './availability.rules';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateHealthDto } from './dto/update-health.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  availability(userId: string) {
    return this.prisma.weeklyAvailability.findMany({
      where: { userId },
      orderBy: { weekday: 'asc' },
    });
  }

  updateProfile(userId: string, dto: UpdateProfileDto) {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        birthDate: dto.birthDate,
        sex: dto.sex,
        heightCm: dto.heightCm,
        weightKg: dto.weightKg,
        address: dto.address,
      },
    });
  }

  updateHealth(userId: string, dto: UpdateHealthDto) {
    return this.prisma.healthProfile.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  async updateAvailability(userId: string, dto: UpdateAvailabilityDto) {
    validateAvailability(dto.availability);

    await this.prisma.$transaction([
      this.prisma.weeklyAvailability.deleteMany({ where: { userId } }),
      ...dto.availability.map((day) =>
        this.prisma.weeklyAvailability.create({
          data: {
            userId,
            weekday: day.weekday,
            noTraining: day.noTraining,
            modalities: day.noTraining ? [] : day.modalities,
            availableMin: day.noTraining ? 0 : day.availableMin,
            modalityDurations: day.noTraining ? undefined : day.modalityDurations ?? {},
          },
        }),
      ),
      this.prisma.trainingPlan.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'archived' },
      }),
    ]);

    return this.prisma.weeklyAvailability.findMany({
      where: { userId },
      orderBy: { weekday: 'asc' },
    });
  }
}
