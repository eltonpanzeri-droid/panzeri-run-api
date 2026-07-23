import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { validateAvailability } from './availability.rules';
import { UpdateAvailabilityDto } from './dto/update-availability.dto';
import { UpdateAnamneseDto } from './dto/update-anamnese.dto';
import { UpdateHealthDto } from './dto/update-health.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { normalizeCpf } from '../billing/billing.service';

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  acceptExerciseResponsibility(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { acceptedExerciseResponsibilityAt: new Date() },
      select: { acceptedExerciseResponsibilityAt: true },
    });
  }

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
    const required = ['objective', 'running_experience', 'personal_name', 'personal_phone', 'personal_birth_date', 'personal_sex', 'personal_height', 'personal_weight', 'personal_cpf', 'personal_education'];
    const missing = required.filter((key) => answers[key] === undefined || answers[key] === '');
    if (missing.length) throw new BadRequestException('Conclua todas as perguntas obrigatorias.');

    const normalizedCpf = normalizeCpf(String(answers.personal_cpf));
    if (!normalizedCpf) throw new BadRequestException('CPF invalido. Revise o campo de CPF na entrevista.');

    if (answers.assessment_method === 'Dobras cutaneas (adipometro)') {
      const assessedWeight = decimalValue(answers.assessment_weight);
      const bodyFat = decimalValue(answers.body_fat_percentage);
      if (assessedWeight !== null && bodyFat !== null) {
        answers.fat_mass = roundedMeasurement(assessedWeight * bodyFat / 100);
        answers.lean_mass = roundedMeasurement(assessedWeight - assessedWeight * bodyFat / 100);
      }
      delete answers.muscle_mass;
      delete answers.visceral_fat;
    }

    if (answers.basal_metabolism === 'automatic' || answers.basal_metabolism === undefined) {
      const basal = harrisBenedict({
        sex: stringValue(answers.personal_sex),
        birthDate: parseInterviewDate(stringValue(answers.personal_birth_date)),
        heightCm: decimalValue(answers.personal_height),
        weightKg: decimalValue(answers.personal_weight),
      });
      answers.basal_metabolism = basal ?? 'Nao foi possivel calcular';
    } else {
      const informedBasal = decimalValue(answers.basal_metabolism);
      if (informedBasal !== null) answers.basal_metabolism = informedBasal;
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
          phone: String(answers.personal_phone),
          birthDate: parseInterviewDate(String(answers.personal_birth_date)),
          sex: String(answers.personal_sex),
          heightCm: decimalValue(answers.personal_height),
          weightKg: decimalValue(answers.personal_weight),
          cpf: normalizedCpf,
          education: String(answers.personal_education),
          address: answers.personal_address ? String(answers.personal_address) : undefined,
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

  // As respostas de rotina da entrevista (${dia}_run_time etc.) so viram registros de
  // WeeklyAvailability dentro de completeOnboarding. Se o aluno reabre a entrevista para
  // revisar/atualizar essas respostas mas nao chega a concluir de novo (ou outra tela de
  // rotina sobrescreve depois), a disponibilidade real usada para gerar o treino fica
  // desatualizada em relacao ao que a entrevista diz. Este metodo recalcula
  // WeeklyAvailability a partir do que ja esta salvo em OnboardingInterview.answers, sem
  // exigir que o aluno refaca a entrevista.
  async syncAvailabilityFromInterview(userId: string) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    if (!interview) {
      throw new BadRequestException('Aluno ainda nao respondeu a entrevista.');
    }
    const answers = asAnswerObject(interview.answers);
    const availability = buildInterviewAvailability(answers);

    await this.prisma.$transaction(async (tx) => {
      await tx.weeklyAvailability.deleteMany({ where: { userId } });
      for (const day of availability) await tx.weeklyAvailability.create({ data: { userId, ...day } });
    });

    return { synced: true, days: availability.filter((day) => !day.noTraining).length };
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
  const br = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date;
    throw new BadRequestException('Data de nascimento invalida.');
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Data de nascimento invalida.');
  return date;
}

const PAIN_DETAIL_KEYS = [
  'pain_detail_knee', 'pain_detail_ankle', 'pain_detail_foot', 'pain_detail_shin', 'pain_detail_calf',
  'pain_detail_thigh', 'pain_detail_hip', 'pain_detail_glute', 'pain_detail_lower_back',
];

function painSummary(answers: Record<string, Prisma.InputJsonValue>) {
  const regions = stringArray(answers.pain_regions);
  if (!regions.length) return 'regiao nao informada';
  const details = PAIN_DETAIL_KEYS.flatMap((key) => stringArray(answers[key]));
  const other = stringValue(answers.pain_other_location);
  const parts = [regions.join(', ')];
  if (details.length) parts.push(`detalhes: ${details.join(', ')}`);
  if (other) parts.push(`outro local: ${other}`);
  return parts.join(' - ');
}

function diagnosedConditionsSummary(answers: Record<string, Prisma.InputJsonValue>) {
  const conditions = stringArray(answers.diagnosed_running_conditions).filter((item) => item !== 'Nenhuma' && item !== 'Nao sei responder');
  const other = stringValue(answers.diagnosed_running_conditions_other);
  if (!conditions.length && !other) return '';
  return `Diagnosticos: ${[...conditions, other].filter(Boolean).join(', ')}`;
}

function interviewInjurySummary(answers: Record<string, Prisma.InputJsonValue>) {
  const parts = [
    answers.current_pain === 'yes' ? `Dor atual: ${painSummary(answers)}` : 'Sem dor atual',
    `Lesao previa: ${stringValue(answers.important_injury) || 'nao informada'}`,
    stringValue(answers.injury_description),
    diagnosedConditionsSummary(answers),
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

function harrisBenedict(input: { sex: string; birthDate: Date; heightCm: number | null; weightKg: number | null }) {
  if (!input.heightCm || !input.weightKg || !['Feminino', 'Masculino'].includes(input.sex)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - input.birthDate.getUTCFullYear();
  const birthdayPassed = now.getUTCMonth() > input.birthDate.getUTCMonth()
    || (now.getUTCMonth() === input.birthDate.getUTCMonth() && now.getUTCDate() >= input.birthDate.getUTCDate());
  if (!birthdayPassed) age -= 1;
  const value = input.sex === 'Masculino'
    ? 88.362 + 13.397 * input.weightKg + 4.799 * input.heightCm - 5.677 * age
    : 447.593 + 9.247 * input.weightKg + 3.098 * input.heightCm - 4.330 * age;
  return Math.round(value);
}
