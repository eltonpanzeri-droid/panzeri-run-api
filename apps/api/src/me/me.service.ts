import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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

  async onboarding(userId: string) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    if (interview?.completedAt && Object.keys(asAnswerObject(interview.answers)).length === 0) {
      return this.prisma.onboardingInterview.update({
        where: { userId },
        data: { completedAt: null, currentStep: 0 },
      });
    }
    return interview ?? { userId, answers: {}, currentStep: 0, completedAt: null };
  }

  reopenOnboarding(userId: string) {
    return this.prisma.onboardingInterview.upsert({
      where: { userId },
      create: { userId, answers: {}, currentStep: 0 },
      update: { completedAt: null, currentStep: 0 },
    });
  }

  async saveOnboardingAnswer(userId: string, dto: { key: string; value: unknown; currentStep: number }) {
    if (!/^[a-z0-9_]+$/i.test(dto.key) || dto.currentStep < 0) {
      throw new BadRequestException('Resposta de entrevista invalida.');
    }
    const current = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    const answers = asAnswerObject(current?.answers);
    answers[dto.key] = JSON.parse(JSON.stringify(dto.value)) as Prisma.InputJsonValue;
    return this.prisma.onboardingInterview.upsert({
      where: { userId },
      create: { userId, answers, currentStep: dto.currentStep },
      update: { answers, currentStep: dto.currentStep },
    });
  }

  async completeOnboarding(userId: string) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    const answers = asAnswerObject(interview?.answers);
    const required = ['objective', 'running_experience', 'current_continuous_run', 'personal_name', 'personal_birth_date', 'personal_sex', 'personal_height', 'personal_weight'];
    const missing = required.filter((key) => answers[key] === undefined || answers[key] === '');
    if (missing.length) throw new BadRequestException('Conclua todas as perguntas obrigatorias.');

    if (answers.assessment_method === 'Dobras cutaneas (adipometro)') {
      const assessedWeight = decimalValue(answers.assessment_weight);
      const bodyFat = decimalValue(answers.body_fat_percentage);
      if (assessedWeight !== null && bodyFat !== null) {
        answers.fat_mass = roundedMeasurement(assessedWeight * bodyFat / 100);
        answers.lean_mass = roundedMeasurement(assessedWeight - assessedWeight * bodyFat / 100);
      }
      delete answers.muscle_mass;
      delete answers.visceral_fat;
      delete answers.basal_metabolism;
    }

    const availability = buildInterviewAvailability(answers);
    const preferredModalities = stringArray(answers.current_activities);
    const healthConditions = stringArray(answers.health_conditions);
    const completedAt = new Date();

    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: String(answers.personal_name),
          birthDate: parseInterviewDate(String(answers.personal_birth_date)),
          sex: String(answers.personal_sex),
          heightCm: decimalValue(answers.personal_height),
          weightKg: decimalValue(answers.personal_weight),
        },
      });
      await tx.healthProfile.upsert({
        where: { userId },
        create: {
          userId,
          averageSleep: stringValue(answers.sleep_hours),
          stressLevel: ratingValue(answers.rating_stress),
          anxietyLevel: ratingValue(answers.rating_anxiety),
          previousInjuries: interviewInjurySummary(answers),
          healthProblems: healthConditions.join(', ') || 'Nenhuma informada',
          medications: stringValue(answers.continuous_medications),
        },
        update: {
          averageSleep: stringValue(answers.sleep_hours),
          stressLevel: ratingValue(answers.rating_stress),
          anxietyLevel: ratingValue(answers.rating_anxiety),
          previousInjuries: interviewInjurySummary(answers),
          healthProblems: healthConditions.join(', ') || 'Nenhuma informada',
          medications: stringValue(answers.continuous_medications),
        },
      });
      await tx.userPreferences.upsert({
        where: { userId },
        create: {
          userId,
          preferredModalities,
          otherModalities: stringArray(answers.favorite_activities),
          trainingLocations: interviewLocations(answers),
          mainGoal: String(answers.objective),
          experienceLevel: String(answers.running_experience),
        },
        update: {
          preferredModalities,
          otherModalities: stringArray(answers.favorite_activities),
          trainingLocations: interviewLocations(answers),
          mainGoal: String(answers.objective),
          experienceLevel: String(answers.running_experience),
        },
      });
      await tx.weeklyAvailability.deleteMany({ where: { userId } });
      for (const day of availability) await tx.weeklyAvailability.create({ data: { userId, ...day } });
      await tx.trainingPlan.updateMany({ where: { userId, status: 'active' }, data: { status: 'archived' } });
      await tx.onboardingInterview.update({ where: { userId }, data: { answers, completedAt } });
    });

    return { completed: true, completedAt, next: 'three_km_test' };
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

function asAnswerObject(value: unknown): Record<string, Prisma.InputJsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, Prisma.InputJsonValue>;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function ratingValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number}/10` : 'Nao informado';
}

function parseInterviewDate(value: string) {
  const br = value.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const date = br ? new Date(`${br[3]}-${br[2]}-${br[1]}T12:00:00.000Z`) : new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Data de nascimento invalida.');
  return date;
}

function interviewInjurySummary(answers: Record<string, Prisma.InputJsonValue>) {
  const parts = [
    answers.current_pain === 'yes' ? `Dor atual: ${stringValue(answers.pain_region) || 'regiao nao informada'}` : 'Sem dor atual',
    `Lesao previa: ${stringValue(answers.important_injury) || 'nao informada'}`,
    stringValue(answers.injury_description),
    stringValue(answers.medical_recommendation),
  ].filter(Boolean);
  return parts.join('. ');
}

function interviewLocations(answers: Record<string, Prisma.InputJsonValue>) {
  const locations = new Set<string>();
  for (const key of Object.keys(answers).filter((item) => item.includes('_run_location'))) {
    const value = String(answers[key]);
    if (value === 'street' || value === 'either') locations.add('Corrida na rua');
    if (value === 'treadmill' || value === 'either') locations.add('Corrida na esteira');
  }
  return [...locations];
}

function buildInterviewAvailability(answers: Record<string, Prisma.InputJsonValue>) {
  const days = [
    { key: 'monday', weekday: 1 },
    { key: 'tuesday', weekday: 2 },
    { key: 'wednesday', weekday: 3 },
    { key: 'thursday', weekday: 4 },
    { key: 'friday', weekday: 5 },
    { key: 'saturday', weekday: 6 },
    { key: 'sunday', weekday: 0 },
  ];
  return days.map(({ key, weekday }) => {
    const runMinutes = interviewMinutes(answers[`${key}_run_time`]);
    const strengthMinutes = interviewMinutes(answers[`${key}_strength_time`]);
    const location = String(answers[`${key}_run_location`] ?? 'either');
    const modalities: string[] = [];
    const modalityDurations: Record<string, number> = {};
    if (runMinutes > 0) {
      const modality = location === 'treadmill' ? 'esteira' : 'corrida';
      modalities.push(modality);
      modalityDurations[modality] = runMinutes;
    }
    if (strengthMinutes > 0) {
      modalities.push('fortalecimento_corredores');
      modalityDurations.fortalecimento_corredores = strengthMinutes;
    }
    return {
      weekday,
      noTraining: modalities.length === 0,
      modalities,
      availableMin: Math.max(runMinutes, strengthMinutes, 0),
      modalityDurations,
    };
  });
}

function interviewMinutes(value: unknown) {
  const options: Record<string, number> = { none: 0, up_to_30: 30, from_30_to_45: 45, from_45_to_60: 60, from_60_to_90: 90, over_90: 105 };
  return options[String(value)] ?? 0;
}

function decimalValue(value: unknown) {
  if (value === undefined || value === null || value === '' || value === 'unknown') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function roundedMeasurement(value: number) {
  return Math.round(value * 10) / 10;
}
