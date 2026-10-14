import { readFileSync } from 'fs';
import { join } from 'path';
import { TargetRacesService } from '../src/target-races/target-races.service';
import { formatRaceForProfile, formatRaceForTelegram } from '../src/target-races/target-race-messages';
import { ProfileEventCode } from '../src/training-plans/student-profile.service';
import { describeTargetRaceError, MAX_TARGET_SECONDS, validateTargetTime } from '../../mobile/src/targetRace/messages';

// Toda meta de prova cadastrada: aviso no Telegram + registro no Prontuario, sem nunca derrubar o cadastro. E mensagens claras no app.
const RACE_DATE = new Date('2026-11-15T12:00:00.000Z'); // domingo (UTC)
const dto = { name: 'Meia de BH', raceDate: '2026-11-15T12:00:00.000Z', distanceKm: 21, targetSeconds: 7200, priority: 'principal', isFirstTimeAtDistance: true, performanceIntent: 9, anxietyLevel: 10, notes: 'Quero muito' };

function build(opts: { routineWeekday?: number; telegramFails?: boolean; profileFails?: boolean; longestKm?: number | null } = {}) {
  const created = { id: 'r1', userId: 'u1', status: 'em_andamento', ...dto, raceDate: RACE_DATE };
  const prisma = {
    targetRace: { create: jest.fn().mockResolvedValue(created) },
    user: { findUniqueOrThrow: jest.fn().mockResolvedValue({ name: 'Thalita Rodrigues', studentCode: 321 }) },
    weeklyAvailability: { findMany: jest.fn().mockResolvedValue(opts.routineWeekday === undefined ? [] : [{ weekday: opts.routineWeekday, noTraining: false }]) },
    trainingSession: { findFirst: jest.fn().mockResolvedValue(opts.longestKm === null ? null : { completion: { distanceKm: opts.longestKm ?? 30 } }) },
  };
  const telegram = { notifyCoach: jest.fn(opts.telegramFails ? async (_text: string) => { throw new Error('telegram fora'); } : async (_text: string) => undefined) };
  const painReports = { computeSafetyTier: jest.fn().mockResolvedValue({ tier: 'normal' }) };
  const studentProfile = { recordEvent: jest.fn(opts.profileFails ? async (_u: string, _c: string, _t: string) => { throw new Error('banco fora'); } : async (_u: string, _c: string, _t: string) => undefined) };
  const service = new TargetRacesService(prisma as never, telegram as never, painReports as never, studentProfile as never);
  return { service, prisma, telegram, studentProfile };
}

describe('toda meta cadastrada avisa o treinador e vai para o Prontuario', () => {
  it('meta sem nenhum risco: AINDA ASSIM manda UMA mensagem ao Telegram e grava UM evento no Prontuario', async () => {
    const t = build({ routineWeekday: 0, longestKm: 30 }); // domingo na rotina; maior treino 30 km
    const result = await t.service.create('u1', dto as never);
    expect(result).toMatchObject({ id: 'r1', paceSecondsPerKm: 343 });
    expect(t.telegram.notifyCoach).toHaveBeenCalledTimes(1);
    const text = t.telegram.notifyCoach.mock.calls[0][0] as string;
    expect(text).toContain('Nova meta de prova cadastrada');
    expect(text).toContain('Thalita Rodrigues');
    expect(text).toContain('321');
    expect(text).toContain('Meia de BH — 21 km em 15/11/2026');
    expect(text).toContain('Tempo-alvo: 2h00min00s');
    expect(text).toContain('intencao de desempenho 9/10');
    expect(text).toContain('Quero muito');
    expect(text).not.toContain('Merece um olhar');
    expect(t.studentProfile.recordEvent).toHaveBeenCalledTimes(1);
    expect(t.studentProfile.recordEvent).toHaveBeenCalledWith('u1', ProfileEventCode.TARGET_RACE_REGISTERED, expect.stringContaining('Meta de prova cadastrada pela aluna.'));
  });

  it('meta com risco (dia fora da rotina): continua UMA so mensagem, com os motivos dentro', async () => {
    const t = build({ routineWeekday: 3, longestKm: 5 });
    await t.service.create('u1', dto as never);
    expect(t.telegram.notifyCoach).toHaveBeenCalledTimes(1);
    const text = t.telegram.notifyCoach.mock.calls[0][0] as string;
    expect(text).toContain('Nova meta de prova cadastrada');
    expect(text).toContain('Merece um olhar');
    expect(text).toContain('nao esta na rotina');
    expect(text).toContain('mais que o dobro do maior treino');
  });

  it('falha do Telegram ou do Prontuario NUNCA derruba o cadastro (a meta ja esta salva)', async () => {
    for (const opts of [{ telegramFails: true }, { profileFails: true }, { telegramFails: true, profileFails: true }]) {
      const t = build({ routineWeekday: 0, ...opts });
      await expect(t.service.create('u1', dto as never)).resolves.toMatchObject({ id: 'r1' });
      // uma falha nao impede a outra acao
      expect(t.telegram.notifyCoach).toHaveBeenCalledTimes(1);
      expect(t.studentProfile.recordEvent).toHaveBeenCalledTimes(1);
    }
  });

  it('a linha do Prontuario so tem fatos informados pela aluna (sem interpretacao)', () => {
    const line = formatRaceForProfile({ ...dto, raceDate: RACE_DATE } as never);
    expect(line).toContain('Meia de BH — 21 km em 15/11/2026');
    expect(line).toContain('Tempo-alvo: 2h00min00s');
    expect(line).toContain('Primeira vez nessa distancia: sim');
    expect(line).toContain('ansiedade 10/10');
    const bare = formatRaceForProfile({ name: 'P', raceDate: RACE_DATE, distanceKm: 10 });
    expect(bare).toContain('Sem tempo-alvo informado');
    expect(bare).not.toContain('Contexto informado');
    expect(formatRaceForTelegram({ name: 'P', raceDate: RACE_DATE, distanceKm: 10 }, { name: 'A', code: '1' }, [])).toContain('Aluno: A (Cod. 1)');
  });

  it('o codigo do evento existe e nao colide com os demais', () => {
    expect(ProfileEventCode.TARGET_RACE_REGISTERED).toBe('TARGET_RACE_REGISTERED');
    expect(new Set(Object.values(ProfileEventCode)).size).toBe(Object.values(ProfileEventCode).length);
  });
});

describe('app: aluna entende por que a meta nao salvou', () => {
  it('tempo-alvo validado ANTES de enviar (inclui o erro de digitar minutos no campo de horas)', () => {
    expect(validateTargetTime('', '', '')).toBeNull();
    expect(validateTargetTime('2', '30', '')).toBeNull();
    expect(validateTargetTime('', '45', '30')).toBeNull();
    expect(validateTargetTime('150', '', '')).toContain('maximo 48 horas');
    expect(validateTargetTime('48', '0', '1')).toContain('maximo 48 horas');
    expect(validateTargetTime('1', '75', '')).toContain('entre 0 e 59');
    expect(validateTargetTime('1', '', '60')).toContain('entre 0 e 59');
    expect(validateTargetTime('1.5', '', '')).toContain('numeros inteiros');
    expect(validateTargetTime('x', '', '')).toContain('numeros inteiros');
    expect(MAX_TARGET_SECONDS).toBe(172800);
  });

  it('recusa do servidor (LISTA de mensagens tecnicas) vira frase clara — nunca mais a mensagem generica sem explicacao', () => {
    expect(describeTargetRaceError(400, { message: ['targetSeconds must not be greater than 172800'] })).toContain('maximo 48 horas');
    expect(describeTargetRaceError(400, { message: ['targetSeconds must be an integer number'] })).toContain('inteiros');
    expect(describeTargetRaceError(400, { message: ['distanceKm must not be greater than 999'] })).toContain('999 km');
    expect(describeTargetRaceError(400, { message: ['raceDate must be a valid ISO 8601 date string'] })).toContain('data da prova');
    expect(describeTargetRaceError(400, { message: ['anxietyLevel must not be less than 1'] })).toContain('1 a 10');
    expect(describeTargetRaceError(400, { message: ['algum campo novo invalido'] })).toContain('Confira os campos');
    expect(describeTargetRaceError(400, { message: ['targetSeconds must be an integer number', 'distanceKm must not be greater than 999'] })).toMatch(/inteiros.*999 km/);
  });

  it('demais falhas: sessao expirada, sem rede, erro de servidor e mensagem em texto simples', () => {
    expect(describeTargetRaceError(401, { message: 'Unauthorized' })).toContain('sessao expirou');
    expect(describeTargetRaceError(0, null)).toContain('Sem conexao');
    expect(describeTargetRaceError(502, {})).toContain('erro 502');
    expect(describeTargetRaceError(500, { message: 'Internal server error' })).toContain('erro 500');
    expect(describeTargetRaceError(404, { message: 'Meta nao encontrada.' })).toBe('Meta nao encontrada.');
  });

  it('a tela usa o validador e o tradutor (e nao a mensagem generica) ao criar a meta', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('validateTargetTime(hours, minutes, seconds)');
    expect(app).toContain('describeTargetRaceError(response.status, data)');
    expect(app).toContain('describeTargetRaceError(0, null)');
    expect(app).not.toContain("'Nao consegui salvar essa meta.'");
  });
});
