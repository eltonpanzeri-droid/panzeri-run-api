import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { validateAvailability } from './availability.rules';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateAnamneseDto } from './dto/update-anamnese.dto';
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

  async updateAnamnese(userId: string, dto: UpdateAnamneseDto) {
    validateAvailability(dto.availability.availability);

    const normalizedEmail = dto.profile.email.trim().toLowerCase();
    const emailOwner = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (emailOwner && emailOwner.id !== userId) {
      throw new BadRequestException('Este e-mail ja pertence a outra conta.');
    }

    return this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: dto.profile.name.trim(),
          email: normalizedEmail,
          birthDate: dto.profile.birthDate,
          sex: dto.profile.sex,
          heightCm: dto.profile.heightCm,
          weightKg: dto.profile.weightKg,
          address: dto.profile.address,
        },
      });

      await tx.healthProfile.upsert({
        where: { userId },
        create: { userId, ...dto.health },
        update: dto.health,
      });

      await tx.userPreferences.upsert({
        where: { userId },
        create: { userId, ...dto.preferences },
        update: dto.preferences,
      });

      await tx.weeklyAvailability.deleteMany({ where: { userId } });
      for (const day of dto.availability.availability) {
        await tx.weeklyAvailability.create({
          data: {
            userId,
            weekday: day.weekday,
            noTraining: day.noTraining,
            modalities: day.noTraining ? [] : day.modalities,
            availableMin: day.noTraining ? 0 : day.availableMin,
            modalityDurations: day.noTraining ? undefined : day.modalityDurations ?? {},
          },
        });
      }

      await tx.trainingPlan.updateMany({
        where: { userId, status: 'active' },
        data: { status: 'archived' },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          accountStatus: true,
          birthDate: true,
          sex: true,
          heightCm: true,
          weightKg: true,
          address: true,
          healthProfile: true,
          preferences: true,
          availability: { orderBy: { weekday: 'asc' } },
          tests: {
            where: { testType: '3km' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    });
  }
}
