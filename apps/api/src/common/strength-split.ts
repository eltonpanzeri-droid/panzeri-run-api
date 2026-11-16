import { BadRequestException } from '@nestjs/common';

// Preferencia de divisao da MUSCULACAO por dia (16/11/2026, ideia de Elton). Depois de salvar a rotina, a aluna que tem musculacao diz se prefere algum grupo muscular em algum dia.
// Sem preferencia = a IA decide livremente (como sempre foi). Com preferencia = a IA recebe o pedido da aluna como contexto de prescricao; o codigo so' guarda e valida a estrutura
// (dia existente na rotina, grupo da lista). Nunca escolhe exercicio, serie ou carga. Fortalecimento para corredores fica de fora. Toda troca de rotina (nova revisao) pergunta de novo.

export const STRENGTH_SPLIT_GROUPS = ['membros_inferiores', 'costas', 'peito', 'ombro', 'biceps', 'triceps', 'abdomen'] as const;
export type StrengthSplitGroup = (typeof STRENGTH_SPLIT_GROUPS)[number];

export const STRENGTH_SPLIT_LABEL: Record<StrengthSplitGroup, string> = {
  membros_inferiores: 'Membros inferiores', costas: 'Costas', peito: 'Peito', ombro: 'Ombro', biceps: 'Bíceps', triceps: 'Tríceps', abdomen: 'Abdômen',
};

// Grupos do catalogo de exercicios (gym-exercise-library.ts) que cada opcao da aluna cobre; vai junto no pedido para a IA filtrar o catalogo.
export const STRENGTH_SPLIT_CATALOG_GROUPS: Record<StrengthSplitGroup, string[]> = {
  membros_inferiores: ['quadriceps', 'posterior', 'gluteos', 'panturrilha', 'quadril'],
  costas: ['costas'], peito: ['peito'], ombro: ['ombros'], biceps: ['biceps'], triceps: ['triceps'], abdomen: ['core'],
};

export interface StrengthSplitRecord {
  answeredRevision: number;
  answeredAt: string;
  hasPreference: boolean;
  // chave = dia da semana (0 domingo ... 6 sabado); lista vazia = "sem preferencia" naquele dia.
  days: Record<string, StrengthSplitGroup[]>;
}

export interface StrengthSplitAnswer { hasPreference: boolean; days?: Record<string, unknown> | null }

const isGroup = (value: unknown): value is StrengthSplitGroup => typeof value === 'string' && (STRENGTH_SPLIT_GROUPS as readonly string[]).includes(value);

export function parseStrengthSplitRecord(raw: unknown): StrengthSplitRecord | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const record = raw as Record<string, unknown>;
  if (typeof record.answeredRevision !== 'number' || typeof record.hasPreference !== 'boolean') return null;
  const days: Record<string, StrengthSplitGroup[]> = {};
  if (record.days && typeof record.days === 'object' && !Array.isArray(record.days)) {
    for (const [weekday, groups] of Object.entries(record.days as Record<string, unknown>)) {
      if (Array.isArray(groups)) days[weekday] = groups.filter(isGroup);
    }
  }
  return { answeredRevision: record.answeredRevision, answeredAt: typeof record.answeredAt === 'string' ? record.answeredAt : '', hasPreference: record.hasPreference, days };
}

// Valida a resposta contra os dias de musculacao da rotina ATUAL e devolve so' o que e' valido e normalizado. Dia fora da rotina de musculacao ou grupo desconhecido = 400.
export function normalizeStrengthSplitAnswer(answer: StrengthSplitAnswer, strengthWeekdays: number[], revision: number, now: Date = new Date()): StrengthSplitRecord {
  const allowed = new Set(strengthWeekdays.map(String));
  const days: Record<string, StrengthSplitGroup[]> = {};
  if (answer.hasPreference) {
    for (const [weekday, groups] of Object.entries(answer.days ?? {})) {
      if (!allowed.has(weekday)) throw new BadRequestException({ code: 'strength_split_invalid_day', message: 'Esse dia não tem musculação na sua rotina atual.' });
      if (!Array.isArray(groups) || groups.some((group) => !isGroup(group))) throw new BadRequestException({ code: 'strength_split_invalid_group', message: 'Grupo muscular inválido.' });
      days[weekday] = [...new Set(groups as StrengthSplitGroup[])];
    }
    for (const weekday of allowed) days[weekday] ??= []; // dia sem marcacao = sem preferencia
  }
  const anyChoice = Object.values(days).some((groups) => groups.length > 0);
  return { answeredRevision: revision, answeredAt: now.toISOString(), hasPreference: answer.hasPreference && anyChoice, days: anyChoice ? days : {} };
}

// A aluna precisa responder? So' quem tem musculacao na rotina atual e ainda nao respondeu PARA ESTA revisao da rotina (toda troca de rotina pergunta de novo).
export function strengthSplitPending(record: StrengthSplitRecord | null, revision: number, strengthWeekdays: number[]): boolean {
  return strengthWeekdays.length > 0 && record?.answeredRevision !== revision;
}

// O que vai para a IA: so' com resposta da revisao atual, com preferencia, e so' para dias que AINDA sao de musculacao. Resposta antiga ou sem preferencia = null (IA livre).
export function strengthSplitForPrompt(record: StrengthSplitRecord | null, revision: number, strengthWeekdays: number[]): Array<{ weekday: number; grupos: Array<{ opcao: string; gruposDoCatalogo: string[] }> }> | null {
  if (!record || !record.hasPreference || record.answeredRevision !== revision) return null;
  const out = strengthWeekdays
    .map((weekday) => ({ weekday, groups: record.days[String(weekday)] ?? [] }))
    .filter((entry) => entry.groups.length > 0)
    .map((entry) => ({ weekday: entry.weekday, grupos: entry.groups.map((group) => ({ opcao: STRENGTH_SPLIT_LABEL[group], gruposDoCatalogo: STRENGTH_SPLIT_CATALOG_GROUPS[group] })) }));
  return out.length > 0 ? out : null;
}
