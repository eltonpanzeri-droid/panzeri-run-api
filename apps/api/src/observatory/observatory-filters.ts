import { BadRequestException } from '@nestjs/common';
import { AGE_BANDS, STRENGTH_BANDS, VOLUME_BANDS, addDays, weekStartOf } from './observatory-core';
import type { ObsFilters, ObsGroupBy } from './observatory.types';

// Observatorio (24/10/2026) — leitura e validacao dos filtros (query string). Piso provisorio de 5 participantes distintos por celula divulgada.
export const DEFAULT_MIN_PARTICIPANTS = 5;
// Regra do Elton (05/11/2026): os dados comecam em 01/08/2026 e QUALQUER calculo usa so' semanas corridas (segunda a domingo, inteiras e ja' encerradas) desde essa data. A semana atual fica
// sempre de fora e nenhuma semana e' descartada por ser "incompleta" ou "sem dados" (semana sem treino entre a primeira e a ultima da aluna conta como 0 km).
export const OBSERVATORY_DATA_START = '2026-08-01';
const GROUPS: ObsGroupBy[] = ['volume', 'age', 'strength', 'sex', 'priorVolume', 'priorStrength'];
// aceita "a,b" e tambem parametros repetidos (?x=a&x=b)
const list = (value: unknown): string[] => {
  const text = Array.isArray(value) ? value.join(',') : value;
  return typeof text === 'string' ? text.split(',').map((x) => x.trim()).filter(Boolean).slice(0, 20) : [];
};
const isDay = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(value + 'T00:00:00Z').toISOString().slice(0, 10) === value;

export function parseObservatoryFilters(query: Record<string, string | undefined>, today: string): ObsFilters {
  if (query.to !== undefined && query.to !== '' && !isDay(query.to)) throw new BadRequestException('Data final inválida (use AAAA-MM-DD).');
  if (query.from !== undefined && query.from !== '' && !isDay(query.from)) throw new BadRequestException('Data inicial inválida (use AAAA-MM-DD).');
  // Periodo SEMPRE alinhado a semanas inteiras: inicio na segunda-feira (a partir de 01/08/2026), fim no domingo da ultima semana encerrada (a semana atual nunca entra).
  const requestedTo = query.to || today;
  const lastClosedSunday = addDays(weekStartOf(today), -1);
  const cappedTo = requestedTo > lastClosedSunday ? lastClosedSunday : requestedTo;
  const to = addDays(weekStartOf(cappedTo), 6) === cappedTo ? cappedTo : addDays(weekStartOf(cappedTo), -1);
  const requestedFrom = query.from && query.from > OBSERVATORY_DATA_START ? query.from : OBSERVATORY_DATA_START;
  const from = weekStartOf(requestedFrom) === requestedFrom ? requestedFrom : addDays(weekStartOf(requestedFrom), 7);
  if (from > to) throw new BadRequestException('Ainda não há semanas completas no período escolhido (a semana atual fica de fora).');
  if ((new Date(to).getTime() - new Date(from).getTime()) / 86_400_000 > 730) throw new BadRequestException('Período longo demais (máximo de 2 anos por consulta).');
  const known = (ids: string[], valid: string[], label: string) => { const bad = ids.filter((id) => !valid.includes(id)); if (bad.length) throw new BadRequestException(`${label} inválida: ${bad.join(', ')}.`); return ids; };
  const groupBy = (query.groupBy as ObsGroupBy | undefined) ?? 'volume';
  if (!GROUPS.includes(groupBy)) throw new BadRequestException('Agrupamento inválido.');
  const mode = query.mode === 'cohort' ? 'cohort' : 'cross';
  const minRaw = query.minParticipants === undefined ? DEFAULT_MIN_PARTICIPANTS : Number(query.minParticipants);
  // o piso nunca pode ser reduzido pelo cliente abaixo do padrao configurado (so' aumentado)
  const minParticipants = Number.isFinite(minRaw) ? Math.max(DEFAULT_MIN_PARTICIPANTS, Math.floor(minRaw)) : DEFAULT_MIN_PARTICIPANTS;
  return {
    from, to, today,
    volumeBands: known(list(query.volumeBands), VOLUME_BANDS.map((b) => b.id), 'Faixa de volume'),
    ageBands: known(list(query.ageBands), [...AGE_BANDS.map((b) => b.id), 'unk'], 'Faixa etária'),
    strengthBands: known(list(query.strengthBands), STRENGTH_BANDS.map((b) => b.id), 'Faixa de força'),
    sexes: known(list(query.sexes), ['F', 'M', 'other', 'unknown'], 'Sexo'),
    mode, groupBy, includeZeroWeeks: query.includeZeroWeeks !== 'false', minParticipants,
  };
}
