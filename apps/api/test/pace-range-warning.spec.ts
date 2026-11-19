import { paceRangeWarning, SessionPartDecision } from '../src/training-plans/training-methodology';
import { PrescriptionAgentService } from '../src/training-plans/prescription-agent.service';

// 19/11/2026 (Elton): "nao bloqueie nada, mas se aparecer sem as faixas, deve aparecer um alerta". Ritmo sem faixa avisa o treinador; a prescricao segue como a IA mandou.
const continua = (min: number, max: number): SessionPartDecision => ({ kind: 'continua', distanceKm: 5, paceSecondsPerKmMin: min, paceSecondsPerKmMax: max });
const intervalada = (extra: Partial<Extract<SessionPartDecision, { kind: 'intervalada' }>> = {}): SessionPartDecision => ({
  kind: 'intervalada', repeatCount: 5, stimulusLabel: 'Forte', stimulusStepKm: 1, stimulusPaceSecondsPerKm: 255, stimulusPaceSecondsPerKmMin: 245, stimulusPaceSecondsPerKmMax: 265,
  recoveryLabel: 'Trote', recoveryStepKm: 0.4, recoveryPaceSecondsPerKm: 390, recoveryPaceSecondsPerKmMin: 370, recoveryPaceSecondsPerKmMax: 410, ...extra,
});

describe('alerta de ritmo sem faixa', () => {
  it('com faixa em todos os trechos: nenhum alerta', () => {
    expect(paceRangeWarning([continua(340, 360)])).toBeNull();
    expect(paceRangeWarning([continua(345, 355), intervalada()])).toBeNull();
  });
  it('parte continua com minimo igual ao maximo: alerta', () => {
    expect(paceRangeWarning([continua(350, 350)])).toContain('o treino');
    expect(paceRangeWarning([continua(340, 360), continua(350, 350)])).toContain('parte 2');
  });
  it('intervalado com faixa igual ou ausente no estimulo ou na recuperacao: alerta que diz qual', () => {
    expect(paceRangeWarning([intervalada({ stimulusPaceSecondsPerKmMin: 255, stimulusPaceSecondsPerKmMax: 255 })])).toContain('estimulo');
    expect(paceRangeWarning([intervalada({ recoveryPaceSecondsPerKmMin: undefined, recoveryPaceSecondsPerKmMax: undefined })])).toContain('recuperacao');
  });
  it('o alerta chega ao aviso do treino e NAO bloqueia: a sessao continua exatamente como a IA mandou', () => {
    const service = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as {
      validateSessions: (sessions: unknown[], slots: unknown[], raceWeekdays: number[]) => { sessions: Array<{ weekday: number; parts: unknown[] }>; sessionMismatches: Record<string, string> };
    };
    const session = { weekday: 2, title: 't', durationMin: 50, notes: 'n', parts: [continua(350, 350)], reasoning: null, durationJustification: null };
    const result = service.validateSessions([session], [{ weekday: 2, durationMin: 50 }], []);
    expect(result.sessions).toHaveLength(1);
    expect(result.sessions[0].parts).toEqual([continua(350, 350)]);
    expect(result.sessionMismatches['2:corrida']).toContain('Ritmo sem faixa');
    // com faixa, sem alerta
    const ok = service.validateSessions([{ ...session, parts: [continua(340, 360)] }], [{ weekday: 2, durationMin: 50 }], []);
    expect(ok.sessionMismatches['2:corrida']).toBeUndefined();
  });
});
