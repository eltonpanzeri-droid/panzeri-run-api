import { BadRequestException } from '@nestjs/common';
import { validateAvailability } from './availability.rules';
import type { AvailabilityDayDto } from './dto/update-availability.dto';

// Regras de gravacao da ROTINA (26/10/2026) — as MESMAS para o aluno e para o treinador. Cobre o que o validador antigo deixava passar (minutos negativos, modalidade fora
// de padrao, dia com treino sem modalidade, duracao de modalidade que nao esta no dia) e separa substituicao integral da semana de alteracao parcial de dias.

const MODALITY_PATTERN = /^[a-z0-9_]{1,40}$/;
export const MAX_ROUTINE_MINUTES = 720;

export interface NormalizedRoutineDay {
  weekday: number;
  noTraining: boolean;
  modalities: string[];
  availableMin: number;
  modalityDurations: Record<string, number>;
}

function bad(message: string): never {
  throw new BadRequestException({ code: 'routine_invalid', message });
}

// Normaliza e valida UM dia. Preserva todas as modalidades recebidas (inclusive legadas, como "bike"): nunca converte uma modalidade em outra.
export function normalizeRoutineDay(day: AvailabilityDayDto): NormalizedRoutineDay {
  if (!Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6) bad('weekday deve estar entre 0 e 6.');
  if (day.noTraining) {
    if (day.modalities.length > 0 || (day.availableMin ?? 0) > 0 || Object.keys(day.modalityDurations ?? {}).length > 0) {
      bad('Quando noTraining=true, modalities deve ser vazio e availableMin deve ser 0 ou null.');
    }
    return { weekday: day.weekday, noTraining: true, modalities: [], availableMin: 0, modalityDurations: {} };
  }
  const modalities = [...new Set(day.modalities.map((item) => (typeof item === 'string' ? item.trim() : '')))];
  if (modalities.length === 0 || modalities.some((item) => !MODALITY_PATTERN.test(item))) bad('Dia com treino precisa de ao menos uma modalidade valida.');
  const durations = day.modalityDurations ?? {};
  for (const [modality, minutes] of Object.entries(durations)) {
    if (!modalities.includes(modality)) bad(`Duracao informada para a modalidade "${modality}", que nao esta neste dia.`);
    if (!Number.isInteger(minutes) || minutes < 1 || minutes > MAX_ROUTINE_MINUTES) bad(`Duracao invalida para "${modality}": use minutos inteiros entre 1 e ${MAX_ROUTINE_MINUTES}.`);
  }
  const availableMin = day.availableMin ?? 0;
  if (!Number.isInteger(availableMin) || availableMin < 0 || availableMin > MAX_ROUTINE_MINUTES) bad(`Tempo disponivel invalido: use minutos inteiros entre 0 e ${MAX_ROUTINE_MINUTES}.`);
  if (availableMin === 0 && Object.keys(durations).length === 0) bad('Dia com treino precisa de tempo disponivel (availableMin ou modalityDurations).');
  return { weekday: day.weekday, noTraining: false, modalities, availableMin, modalityDurations: { ...durations } };
}

// Substituicao INTEGRAL: a semana inteira (os sete dias, sem repeticao). Uma lista parcial NUNCA chega a apagar os demais dias — vai para o PATCH de dias.
export function validateFullRoutineWeek(days: AvailabilityDayDto[]): NormalizedRoutineDay[] {
  validateAvailability(days);
  if (days.length !== 7) bad('Envie a semana inteira (os 7 dias). Para alterar so alguns dias, use a alteracao parcial.');
  return days.map(normalizeRoutineDay).sort((left, right) => left.weekday - right.weekday);
}

// Alteracao PARCIAL: so os dias enviados mudam; o resto da semana permanece exatamente como esta.
export function validateRoutinePatch(days: AvailabilityDayDto[]): NormalizedRoutineDay[] {
  validateAvailability(days);
  if (days.length === 0 || days.length > 7) bad('Informe de 1 a 7 dias.');
  return days.map(normalizeRoutineDay).sort((left, right) => left.weekday - right.weekday);
}

type StoredDay = { weekday: number; noTraining: boolean; modalities: string[]; availableMin: number | null; modalityDurations: unknown };

function durations(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, number] => typeof entry[1] === 'number').sort(([a], [b]) => a.localeCompare(b)),
  );
}

export function routineDaySignature(day: StoredDay | NormalizedRoutineDay) {
  return {
    weekday: day.weekday,
    noTraining: day.noTraining,
    modalities: day.noTraining ? [] : [...day.modalities].sort(),
    availableMin: day.noTraining ? 0 : day.availableMin ?? 0,
    modalityDurations: day.noTraining ? {} : durations(day.modalityDurations),
  };
}

export function routineSignature(days: Array<StoredDay | NormalizedRoutineDay>): string {
  return JSON.stringify(days.map(routineDaySignature).sort((left, right) => left.weekday - right.weekday));
}

// Forma minimizada guardada no historico de alteracoes (so' agenda; nada de texto livre).
export function minimizedRoutine(days: Array<StoredDay | NormalizedRoutineDay>) {
  return days.map(routineDaySignature).sort((left, right) => left.weekday - right.weekday);
}
