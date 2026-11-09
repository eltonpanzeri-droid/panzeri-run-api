import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';
import { requiredStrengthSlots } from '../src/training-plans/training-methodology';

// 09/11/2026 (caso Andreia): "Nao, a partir de amanha" manda a IA pular os dias anteriores; a conferencia NAO pode exigir a forca desses dias (antes derrubava a semana inteira).
const mondayFort = { weekday: 1, modality: 'fortalecimento_corredores' as const, durationMin: 30 };
const wednesdayForca = { weekday: 3, modality: 'forca' as const, durationMin: 45 };
const weekDates = [{ weekday: 1, date: '2026-11-09' }, { weekday: 3, date: '2026-11-11' }];

describe('requiredStrengthSlots', () => {
  it('sem "gerar a partir de": todos os dias da rotina (comportamento de sempre)', () => {
    expect(requiredStrengthSlots([mondayFort, wednesdayForca], weekDates, null)).toEqual([mondayFort, wednesdayForca]);
    expect(requiredStrengthSlots([mondayFort, wednesdayForca], weekDates, undefined)).toEqual([mondayFort, wednesdayForca]);
  });
  it('caso Andreia: hoje (segunda 09/11) e escolhe "a partir de amanha": a forca de segunda deixa de ser exigida; quarta continua', () => {
    expect(requiredStrengthSlots([mondayFort, wednesdayForca], weekDates, '2026-11-10')).toEqual([wednesdayForca]);
    expect(requiredStrengthSlots([mondayFort], weekDates, '2026-11-10')).toEqual([]);
  });
  it('o proprio dia de partida continua exigido (>=)', () => {
    expect(requiredStrengthSlots([mondayFort, wednesdayForca], weekDates, '2026-11-11')).toEqual([wednesdayForca]);
    expect(requiredStrengthSlots([mondayFort, wednesdayForca], weekDates, '2026-11-09')).toEqual([mondayFort, wednesdayForca]);
  });
  it('dia sem data conhecida continua exigido (conservador)', () => {
    expect(requiredStrengthSlots([mondayFort], [], '2026-11-10')).toEqual([mondayFort]);
    expect(requiredStrengthSlots([mondayFort], undefined, '2026-11-10')).toEqual([mondayFort]);
  });
});

function service() {
  return new PrescriptionAgentService({ get: jest.fn().mockReturnValue('') } as never, { run: (fn: () => Promise<unknown>) => fn() } as never) as any;
}
const aiSession = (weekday: number, modality: string) => ({ weekday, modality, title: 't', exerciseIds: ['a', 'b', 'c'], sets: 3, reps: '10', restSeconds: 45, intensity: 'Leve', notes: '', reasoning: null });

describe('validateStrengthSessions com dias exigidos', () => {
  it('padrao (sem o 3o parametro): todo dia da rotina ausente continua sendo "faltou" — nada mudou', () => {
    const result = service().validateStrengthSessions([], [mondayFort, wednesdayForca]);
    expect(result.missingSlots.map((s: { weekday: number }) => s.weekday)).toEqual([1, 3]);
  });
  it('com dias exigidos: so os exigidos que faltarem pedem reparo', () => {
    const result = service().validateStrengthSessions([], [mondayFort, wednesdayForca], [wednesdayForca]);
    expect(result.missingSlots.map((s: { weekday: number }) => s.weekday)).toEqual([3]);
  });
  it('nenhum dia exigido faltando: sem reparo e a semana segue', () => {
    const result = service().validateStrengthSessions([aiSession(3, 'forca')], [mondayFort, wednesdayForca], [wednesdayForca]);
    expect(result.missingSlots).toEqual([]);
    expect(result.sessions).toHaveLength(1);
  });
  it('se a IA trouxer mesmo assim o dia pulado, ele e aceito como da rotina (nao vira "fora da rotina")', () => {
    const result = service().validateStrengthSessions([aiSession(1, 'fortalecimento_corredores'), aiSession(3, 'forca')], [mondayFort, wednesdayForca], [wednesdayForca]);
    expect(result.missingSlots).toEqual([]);
    expect(result.sessions).toHaveLength(2);
    expect(result.sessionMismatches).toEqual({});
  });
  it('um dia FORA da rotina continua sendo aceito como diretriz e sinalizado, como antes', () => {
    const result = service().validateStrengthSessions([aiSession(5, 'forca')], [mondayFort], [mondayFort]);
    expect(Object.keys(result.sessionMismatches)).toEqual(['5:forca']);
    expect(result.missingSlots.map((s: { weekday: number }) => s.weekday)).toEqual([1]);
  });
});

describe('ligacao na geracao semanal (estatico)', () => {
  it('a geracao semanal calcula os dias exigidos com generateFrom e os passa para a conferencia', () => {
    const source = readFileSync(join(__dirname, '..', 'src', 'training-plans', 'prescription-agent.service.ts'), 'utf8');
    expect(source).toContain('const requiredSlots = requiredStrengthSlots(strengthSlots, input.weekDates, input.generateFrom);');
    expect(source).toContain('this.validateStrengthSessions(parsed.strengthSessions, strengthSlots, requiredSlots)');
  });
});
