import { readFileSync } from 'fs';
import { join } from 'path';
import { planRaceCalendarChanges } from '../src/target-races/target-race-calendar';
import { AiWeeklyDecisionSchema, RACE_CALENDAR_INSTRUCTION, RACE_STRATEGY_INSTRUCTION } from '../src/training-plans/prescription-agent.service';
import { RACE_STAMP_TEXT, raceDayNoticeFor, raceDayRestNotice, raceOfSession } from '../../mobile/src/raceDay/raceDay';

// 19/11/2026 (Elton): a prova NUNCA trava nada. Tres casos do dia da prova, o carimbo no cartao da prova, o alerta de descanso nos outros treinos do dia e o agente seguindo PREFERENCIALMENTE o pace do aluno.
describe('dia da prova no calendario (servidor): os tres casos de Elton', () => {
  const race = { id: 'r1', name: 'Meia de BH', raceDate: new Date('2026-11-22T00:00:00.000Z'), distanceKm: 21.1, targetSeconds: 7200 };
  const planStart = new Date('2026-11-16T00:00:00.000Z');
  const planEnd = new Date('2026-11-22T00:00:00.000Z');
  const session = (over: Record<string, unknown>) => ({ id: 's', scheduledDate: new Date('2026-11-22T00:00:00.000Z'), modality: 'corrida', origin: 'agent', hasDependents: false, structure: {}, ...over });

  it('1) dia com corrida: a prova ENTRA NO LUGAR do treino de corrida', () => {
    const changes = planRaceCalendarChanges({ planStart, planEnd, races: [race], sessions: [session({ id: 'run1' })] });
    expect(changes.create).toHaveLength(1);
    expect(changes.create[0]).toMatchObject({ modality: 'corrida', sessionType: 'prova', title: 'Meia de BH' });
    expect(changes.deleteSessionIds).toEqual(['run1']);
  });

  it('2) dia com corrida + outra modalidade: a prova substitui so a corrida e a outra modalidade continua na rotina', () => {
    const changes = planRaceCalendarChanges({ planStart, planEnd, races: [race], sessions: [session({ id: 'run1' }), session({ id: 'gym1', modality: 'forca' })] });
    expect(changes.deleteSessionIds).toEqual(['run1']);
    expect(changes.deleteSessionIds).not.toContain('gym1');
    expect(changes.create).toHaveLength(1);
  });

  it('3) dia livre ou so com outra modalidade: a prova entra como treino de corrida (nada e removido), com o dado de prova na estrutura', () => {
    const onlyGym = planRaceCalendarChanges({ planStart, planEnd, races: [race], sessions: [session({ id: 'gym1', modality: 'forca' })] });
    expect(onlyGym.deleteSessionIds).toEqual([]);
    expect(onlyGym.create[0].structure.race).toMatchObject({ targetRaceId: 'r1', name: 'Meia de BH' });
    const free = planRaceCalendarChanges({ planStart, planEnd, races: [race], sessions: [] });
    expect(free.create).toHaveLength(1);
    expect(free.create[0].structure.paceRange).toBe('5:41/km'); // pace-alvo do PROPRIO aluno: 7200 s / 21,1 km
  });
});

describe('carimbo e alerta de dia de prova (mobile, funcoes puras)', () => {
  const raceCard = { structure: { type: 'run', race: { targetRaceId: 'r1', name: 'Meia de BH' } } };
  const gym = { structure: { type: 'strength' } };

  it('o cartao da prova e reconhecido (carimbo); treino comum nao', () => {
    expect(raceOfSession(raceCard)).toEqual({ name: 'Meia de BH' });
    expect(raceOfSession(gym)).toBeNull();
    expect(raceOfSession({ structure: null })).toBeNull();
    expect(raceOfSession(undefined)).toBeNull();
    expect(RACE_STAMP_TEXT).toContain('PROVA MARCADA POR VOCÊ');
  });

  it('outro treino no mesmo dia da prova recebe o alerta sugerindo descansar; a propria prova, nao', () => {
    expect(raceDayNoticeFor(gym, [raceCard, gym])).toBe(raceDayRestNotice('Meia de BH'));
    expect(raceDayRestNotice('Meia de BH')).toContain('Sugerimos não fazer este treino, para você descansar');
    expect(raceDayNoticeFor(raceCard, [raceCard, gym])).toBeNull();
  });

  it('dia sem prova, treino extra e atividade alternativa nao recebem alerta', () => {
    expect(raceDayNoticeFor(gym, [gym])).toBeNull();
    expect(raceDayNoticeFor({ structure: { type: 'extra' } }, [raceCard])).toBeNull();
    expect(raceDayNoticeFor({ structure: {}, isAlternative: true }, [raceCard])).toBeNull();
  });
});

describe('agente: prova nunca trava e segue preferencialmente o pace do aluno', () => {
  it('semana sem corrida da rotina (so o dia da prova) nao e recusada: o esquema aceita zero sessoes de corrida e o codigo so recusa sem dia de prova', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'training-plans', 'prescription-agent.service.ts'), 'utf8');
    expect(source).toContain('if (!runSlots.length && !input.availability.some((day) => day.raceDay === true))');
    expect(AiWeeklyDecisionSchema.shape.sessions.safeParse([]).success).toBe(true);
  });

  it('instrucoes: alerta de descanso nas outras modalidades, pace do aluno preferencial, autonomia e justificativa com os dados coletados', () => {
    expect(RACE_CALENDAR_INSTRUCTION).toContain('alerta de dia de prova sugerindo nao fazer esse treino e descansar');
    expect(RACE_STRATEGY_INSTRUCTION).toContain('siga-o PREFERENCIALMENTE');
    expect(RACE_STRATEGY_INSTRUCTION).toContain('autonomia para montar a estrategia da prova');
    expect(RACE_STRATEGY_INSTRUCTION).toContain('mais forte ou mais leve');
    expect(RACE_STRATEGY_INSTRUCTION).toContain('JUSTIFIQUE com os dados ja coletados');
    expect(RACE_STRATEGY_INSTRUCTION).toContain('sugerir e prescrever');
    expect(`${RACE_CALENDAR_INSTRUCTION}${RACE_STRATEGY_INSTRUCTION}`).not.toContain("'");
  });

  it('a tela mostra o carimbo no cartao da prova e o alerta nos outros treinos do dia', () => {
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('const raceOfCard = raceOfSession(session);');
    expect(app).toContain('const raceDayNotice = raceDayNoticeFor(session, group.sessions);');
    expect(app).toContain('accessibilityLabel={RACE_STAMP_TEXT}');
    expect(app).toContain('{raceDayNotice}</Text>');
  });
});
