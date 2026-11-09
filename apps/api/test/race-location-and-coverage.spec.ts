import 'reflect-metadata';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { formatRaceWhere as mobileWhere, formatTimeInputText, normalizeStartTime, validateRaceLocation } from '../../mobile/src/targetRace/raceLocation';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import { raceCoveredWeekdays } from '../src/training-plans/training-methodology';
import { CreateTargetRaceDto } from '../src/target-races/dto/create-target-race.dto';
import { UpdateTargetRaceDto } from '../src/target-races/dto/update-target-race.dto';
import { describeRaceChanges, formatRaceForProfile, formatRaceForTelegram } from '../src/target-races/target-race-messages';
import { formatRaceWhere, normalizeRaceLocation } from '../src/target-races/race-location';

// 09/11/2026 (Elton): (1) dia da prova no aviso de rotina = "coberto por prescricao de prova alvo" (o alerta continua, com o nome certo); (2) local e horario da prova alvo, para o futuro indice WBGT.
const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');

describe('(1) dia da prova no aviso de rotina', () => {
  it('raceCoveredWeekdays: pega o dia da semana da data da prova ativa nesta semana', () => {
    const weekDates = [{ weekday: 2, date: '2026-11-10' }, { weekday: 6, date: '2026-11-14' }];
    expect(raceCoveredWeekdays([{ raceDate: '2026-11-14T00:00:00.000Z' }], weekDates)).toEqual([6]);
    expect(raceCoveredWeekdays([{ raceDate: '2026-11-21T00:00:00.000Z' }], weekDates)).toEqual([]); // prova em outra semana
    expect(raceCoveredWeekdays(undefined, weekDates)).toEqual([]);
    expect(raceCoveredWeekdays([{ raceDate: '2026-11-14T00:00:00.000Z' }], undefined)).toEqual([]);
  });

  const service = () => new PrescriptionAgentService({ get: jest.fn().mockReturnValue('') } as never, { run: jest.fn() } as never) as any;
  const slots = [2, 3, 5, 6].map((weekday) => ({ weekday, durationMin: 60 }));
  const session = (weekday: number) => ({ weekday, title: 't', durationMin: 38, durationJustification: 'polimento antes da prova', notes: '', parts: [], reasoning: null });

  it('caso Brenda: sabado = prova alvo -> "coberto por prescricao de prova alvo"; sexta continua "sem cobertura"; o aviso NAO some', () => {
    const result = service().validateSessions([session(2), session(3)], slots, [6]);
    expect(result.routineMismatch).toContain('IA gerou 2 dia(s) de corrida em vez dos 4 combinados na rotina');
    expect(result.routineMismatch).toContain('(sem cobertura: sexta-feira)');
    expect(result.routineMismatch).toContain('(coberto por prescricao de prova alvo: sabado)');
    expect(result.routineMismatch).not.toContain('sem cobertura: sexta-feira, sabado');
    expect(result.missingRunWeekdays).toEqual([5]);
    expect(result.raceCoveredRunWeekdays).toEqual([6]);
  });
  it('so o dia da prova faltando: o aviso continua, mas sem "sem cobertura"', () => {
    const result = service().validateSessions([session(2), session(3), session(5)], slots, [6]);
    expect(result.routineMismatch).toContain('(coberto por prescricao de prova alvo: sabado)');
    expect(result.routineMismatch).not.toContain('sem cobertura');
    expect(result.missingRunWeekdays).toEqual([]);
  });
  it('sem prova na semana: comportamento de sempre ("sem cobertura" para os dois dias)', () => {
    const result = service().validateSessions([session(2), session(3)], slots);
    expect(result.routineMismatch).toContain('(sem cobertura: sexta-feira, sabado)');
    expect(result.raceCoveredRunWeekdays).toEqual([]);
    expect(result.missingRunWeekdays).toEqual([5, 6]);
  });
  it('o Telegram diz "coberto por prescrição de prova alvo" no dia da prova (estatico)', () => {
    const source = read('src', 'training-plans', 'training-plans.service.ts');
    expect(source).toContain('— coberto por prescrição de prova alvo');
    expect(source).toContain('methodology.routineMismatchRaceCoveredWeekdays');
    expect(read('src', 'training-plans', 'prescription-agent.service.ts')).toContain('raceCoveredWeekdays(input.targetRaces, input.weekDates)');
  });
});

describe('(2) local e horario da prova alvo', () => {
  it('normaliza so o que foi enviado: UF em maiusculas, espacos limpos, horario invalido vira null, vazio limpa', () => {
    expect(normalizeRaceLocation({})).toEqual({});
    expect(normalizeRaceLocation({ city: '  Belo   Horizonte ', state: 'mg', startTime: '06:30' })).toEqual({ city: 'Belo Horizonte', state: 'MG', startTime: '06:30' });
    expect(normalizeRaceLocation({ city: '', state: '', startTime: '' })).toEqual({ city: null, state: null, startTime: null });
    expect(normalizeRaceLocation({ startTime: '25:00' })).toEqual({ startTime: null });
    expect(normalizeRaceLocation({ city: null })).toEqual({ city: null });
  });
  it('texto do local: cidade/UF e largada, em qualquer combinacao', () => {
    expect(formatRaceWhere({ city: 'Contagem', state: 'MG', startTime: '06:00' })).toBe('Contagem/MG, largada 06:00');
    expect(formatRaceWhere({ city: 'Contagem', startTime: '06:00' })).toBe('Contagem, largada 06:00');
    expect(formatRaceWhere({ startTime: '06:00' })).toBe('largada 06:00');
    expect(formatRaceWhere({})).toBeNull();
  });
  it('a API valida (HH:MM de 00:00 a 23:59, UF de 2 letras) e aceita prova antiga sem esses campos', async () => {
    const base = { name: 'Prova', raceDate: '2026-11-14', distanceKm: 30.4 };
    expect(await validate(plainToInstance(CreateTargetRaceDto, base))).toHaveLength(0);
    expect(await validate(plainToInstance(CreateTargetRaceDto, { ...base, city: 'Contagem', state: 'MG', startTime: '06:00' }))).toHaveLength(0);
    expect((await validate(plainToInstance(CreateTargetRaceDto, { ...base, startTime: '25:00' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateTargetRaceDto, { ...base, startTime: '6:00' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateTargetRaceDto, { ...base, state: 'MGX' }))).length).toBeGreaterThan(0);
    expect((await validate(plainToInstance(CreateTargetRaceDto, { ...base, city: 'x'.repeat(81) }))).length).toBeGreaterThan(0);
  });
  it('na edicao, null limpa o valor', async () => {
    expect(await validate(plainToInstance(UpdateTargetRaceDto, { city: null, state: null, startTime: null }))).toHaveLength(0);
  });
  it('Telegram e Prontuario trazem o local; a mudanca de local aparece; prova sem local nao muda nada', () => {
    const race = { name: 'Corrida de aniversario', raceDate: new Date('2026-11-14T00:00:00Z'), distanceKm: 30.4, city: 'Contagem', state: 'MG', startTime: '06:00' };
    expect(formatRaceForTelegram(race, { name: 'Brenda', code: '0000065' }, [])).toContain('Local: Contagem/MG, largada 06:00');
    expect(formatRaceForProfile(race)).toContain('Local: Contagem/MG, largada 06:00');
    expect(formatRaceForProfile({ ...race, city: null, state: null, startTime: null })).not.toContain('Local:');
    expect(describeRaceChanges(race, { ...race, startTime: '07:00' })).toEqual(['Local e horario: Contagem/MG, largada 06:00 -> Contagem/MG, largada 07:00']);
    expect(describeRaceChanges(race, { ...race })).toEqual([]);
    expect(describeRaceChanges({ ...race, city: null, state: null, startTime: null }, { ...race, city: null, state: null, startTime: null })).toEqual([]);
  });
  it('criacao e edicao gravam local e horario normalizados; o painel recebe os campos (estatico)', () => {
    const service = read('src', 'target-races', 'target-races.service.ts');
    expect(service.match(/\.\.\.normalizeRaceLocation\(\{ city: dto\.city, state: dto\.state, startTime: dto\.startTime \}\)/g)).toHaveLength(2);
    const coach = read('src', 'coach', 'coach.service.ts');
    expect(coach).toContain('city: race.city ?? null');
    expect(coach).toContain('startTime: race.startTime ?? null');
    expect(read('prisma', 'schema.prisma')).toMatch(/city\s+String\?\s+state\s+String\?\s+startTime\s+String\?/);
    expect(read('prisma', 'migrations', '20261109180000_target_race_location', 'migration.sql')).toContain('ADD COLUMN "city" TEXT, ADD COLUMN "state" TEXT, ADD COLUMN "startTime" TEXT');
  });
});

describe('formulario da aluna (apps/mobile)', () => {
  it('horario: digitos viram hh:mm; so aceita 00:00 a 23:59', () => {
    expect(formatTimeInputText('0600')).toBe('06:00');
    expect(formatTimeInputText('06')).toBe('06');
    expect(formatTimeInputText('06:0a9')).toBe('06:09');
    expect(normalizeStartTime('6:00')).toBe('06:00');
    expect(normalizeStartTime('23:59')).toBe('23:59');
    expect(normalizeStartTime('24:00')).toBeNull();
    expect(normalizeStartTime('12:60')).toBeNull();
    expect(normalizeStartTime('')).toBeNull();
  });
  it('ao CADASTRAR: cidade e horario obrigatorios; ao EDITAR prova antiga: opcionais, mas horario digitado tem que ser valido', () => {
    expect(validateRaceLocation({ city: '', state: '', time: '06:00' }, { required: true })).toContain('cidade');
    expect(validateRaceLocation({ city: 'Contagem', state: '', time: '' }, { required: true })).toContain('horário');
    expect(validateRaceLocation({ city: 'Contagem', state: '', time: '06:00' }, { required: true })).toBeNull();
    expect(validateRaceLocation({ city: '', state: '', time: '' }, { required: false })).toBeNull();
    expect(validateRaceLocation({ city: 'Contagem', state: '', time: '99:99' }, { required: false })).toContain('formato hh:mm');
    expect(validateRaceLocation({ city: 'Contagem', state: 'MGX', time: '06:00' }, { required: true })).toContain('UF');
  });
  it('texto do cartao da prova', () => {
    expect(mobileWhere({ city: 'Contagem', state: 'MG', startTime: '06:00' })).toBe('Contagem/MG · largada 06:00');
    expect(mobileWhere({ city: null, state: null, startTime: null })).toBeNull();
  });
  it('o formulario tem os campos e envia cidade, UF e horario (estatico)', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('placeholder="Cidade da prova (ex: Belo Horizonte)"');
    expect(app).toContain('placeholder="Largada (hh:mm)"');
    expect(app).toContain('validateRaceLocation({ city: cityInput, state: stateInput, time: startTimeInput }, { required: editingId === null })');
    expect(app).toContain('startTime: normalizeStartTime(startTimeInput) ?? clear');
    const admin = readFileSync(join(__dirname, '..', '..', 'admin', 'app', 'page.tsx'), 'utf8');
    expect(admin).toContain('local e horário não informados');
  });
});
