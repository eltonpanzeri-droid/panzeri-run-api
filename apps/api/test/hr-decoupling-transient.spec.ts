import { computeHrDecoupling, HR_DECOUPLING_ALGORITHM_VERSION, HR_DECOUPLING_PARAMS, HR_DECOUPLING_REASON_TEXT, SeriesPointInput } from '../src/training-intelligence/hr-decoupling';

// 08/11/2026 — ordem tecnica ELTON²: tolerancia a oscilacoes TRANSITORIAS de velocidade no desacoplamento (algoritmo versao 2). Cenarios A a G da ordem + auditoria + compatibilidade.
// Corrida sintetica de 60 min a 10 km/h, FC 150, 1 amostra por segundo, salvo indicacao.
const SECONDS = 3600;
function base(): SeriesPointInput[] {
  const out: SeriesPointInput[] = [];
  for (let t = 0; t <= SECONDS; t++) out.push({ offsetSec: t, heartRateBpm: 150, speedKmh: 10 });
  return out;
}
function setSpeed(points: SeriesPointInput[], from: number, durationSec: number, kmh: number | null): SeriesPointInput[] {
  for (const p of points) if (p.offsetSec >= from && p.offsetSec < from + durationSec) p.speedKmh = kmh;
  return points;
}
const eventsAt = (points: SeriesPointInput[], starts: number[], durationSec: number, kmh: number) => starts.reduce((acc, from) => setSpeed(acc, from, durationSec, kmh), points);

describe('Cenario A — corrida continua com falha breve de GPS', () => {
  it('pico de 4 s a 30 km/h: preserva a elegibilidade, COM RESSALVAS, e o evento sai do calculo', () => {
    const r = computeHrDecoupling(setSpeed(base(), 1000, 4, 30));
    expect(r.eligible).toBe(true);
    expect(r.qualityStatus).toBe('valid_with_caveats');
    expect(r.transientEventCount).toBe(1);
    expect(r.transientEventSec).toBe(4);
    expect(r.speedCvPct).toBeCloseTo(0, 6); // sem o pico, a velocidade e' estavel
    expect(r.decouplingPct).toBeCloseTo(0, 6);
  });
  it('um unico pico de 3 s a 50 km/h NAO reprova mais a corrida (antes reprovava por CV de 11,5%)', () => {
    const r = computeHrDecoupling(setSpeed(base(), 1000, 3, 50));
    expect(r.eligible).toBe(true);
    expect(r.qualityStatus).toBe('valid_with_caveats');
  });
});

describe('Cenario B — travessia de rua', () => {
  it('8 s a 2 km/h e retorno ao ritmo: evento transitorio, amostras de velocidade e FC afetadas excluidas (inclusive a estabilizacao da FC)', () => {
    const points = base();
    // a FC cai durante a travessia e demora a voltar: se essas amostras entrassem, o desacoplamento sairia distorcido
    for (const p of points) if (p.offsetSec >= 1000 && p.offsetSec < 1050) p.heartRateBpm = 135;
    const r = computeHrDecoupling(setSpeed(points, 1000, 8, 2));
    expect(r.eligible).toBe(true);
    expect(r.qualityStatus).toBe('valid_with_caveats');
    expect(r.transientEventCount).toBe(1);
    expect(r.excludedSec).toBe(8 + HR_DECOUPLING_PARAMS.hrStabilizationSec);
    expect(r.decouplingPct).toBeCloseTo(0, 6); // a FC distorcida ficou fora da media
  });
  it('parada (velocidade 0) de 8 s tambem e evento; a FC desses segundos sai junto (antes so a velocidade era descartada)', () => {
    const points = base();
    for (const p of points) if (p.offsetSec >= 1000 && p.offsetSec < 1030) p.heartRateBpm = 120;
    const r = computeHrDecoupling(setSpeed(points, 1000, 8, 0));
    expect(r.eligible).toBe(true);
    expect(r.meanHr1).toBeCloseTo(150, 6);
    expect(r.decouplingPct).toBeCloseTo(0, 6);
  });
  it('parada MAIOR que 10 s e interrupcao relevante: inconclusivo, sem valor confiavel', () => {
    const r = computeHrDecoupling(setSpeed(base(), 1800, 30, 0));
    expect(r.eligible).toBe(false);
    expect(r.qualityStatus).toBe('inconclusive');
    expect(r.exclusionReason).toBe('interrupcao_acima_da_tolerancia');
    expect(r.decouplingPct).toBeNull();
  });
});

describe('Cenario C — treino intervalado', () => {
  it('alternancia repetida de trechos rapidos e lentos nunca vira continuo', () => {
    const points = base().map((p) => ({ ...p, speedKmh: Math.floor(p.offsetSec / 60) % 2 === 0 ? 14 : 8 }));
    const r = computeHrDecoupling(points);
    expect(r.eligible).toBe(false);
    expect(r.qualityStatus).toBe('inconclusive');
  });
  it('intervalos curtos de 10 s tambem nao passam: sequencia sistematica de eventos', () => {
    const points = base().map((p) => ({ ...p, speedKmh: Math.floor(p.offsetSec / 10) % 2 === 0 ? 14 : 8 }));
    const r = computeHrDecoupling(points);
    expect(r.eligible).toBe(false);
  });
});

describe('Cenario D — GPS instavel', () => {
  it('muitas oscilacoes distribuidas: inconclusivo por frequencia/acumulo', () => {
    const starts = Array.from({ length: 12 }, (_, i) => 300 + i * 280);
    const r = computeHrDecoupling(eventsAt(base(), starts, 3, 30));
    expect(r.eligible).toBe(false);
    expect(r.exclusionReason).toBe('padrao_sistematico_de_eventos');
  });
  it('dois eventos muito proximos (menos de 2 min) sao sequencia sistematica', () => {
    const r = computeHrDecoupling(setSpeed(setSpeed(base(), 1000, 3, 30), 1060, 3, 30));
    expect(r.exclusionReason).toBe('padrao_sistematico_de_eventos');
  });
  it('tempo acumulado acima de 3% do trecho: inconclusivo', () => {
    // 2 eventos de 10 s a cada 20 min nao somam; usa corrida curta de 35 min: 3% = 63 s; 7 eventos de 10 s = 70 s
    const shortRun: SeriesPointInput[] = [];
    for (let t = 0; t <= 2100; t++) shortRun.push({ offsetSec: t, heartRateBpm: 150, speedKmh: 10 });
    const r = computeHrDecoupling(eventsAt(shortRun, [150, 450, 750, 1050, 1350, 1650, 1900], 10, 30), { ...HR_DECOUPLING_PARAMS, eventsMinCount: 20 });
    expect(r.exclusionReason).toBe('eventos_acima_do_limite_acumulado');
  });
});

describe('Cenario E — ritmo sustentadamente diferente', () => {
  it('10 minutos mais rapido NAO e oscilacao transitoria: os criterios de sempre se aplicam (metades diferem > 5%)', () => {
    const r = computeHrDecoupling(setSpeed(base(), 2400, 600, 12.5));
    expect(r.eligible).toBe(false);
    expect(r.exclusionReason).toBe('diferenca_entre_metades_acima_do_limite');
    expect(r.transientEventCount).toBe(0);
    expect(r.sustainedEventCount).toBeGreaterThanOrEqual(0);
  });
  it('oscilacao de 15 s (acima da tolerancia de 10 s) nao e tolerada nem excluida', () => {
    const r = computeHrDecoupling(setSpeed(base(), 1000, 15, 3));
    expect(r.transientEventCount).toBe(0);
    expect(r.sustainedEventCount).toBe(1);
  });
});

describe('Cenario F — falhas de registro', () => {
  it('FC ausente por 8 min numa metade: cobertura insuficiente, sem preencher nada', () => {
    const points = base().map((p) => (p.offsetSec >= 2400 && p.offsetSec < 2880 ? { ...p, heartRateBpm: null } : p));
    const r = computeHrDecoupling(points);
    expect(r.eligible).toBe(false);
    expect(r.exclusionReason).toBe('cobertura_insuficiente');
  });
  it('sem velocidade (provedor sem velocidade instantanea): inconclusivo, sem erro', () => {
    const r = computeHrDecoupling(base().map((p) => ({ ...p, speedKmh: null })));
    expect(r.eligible).toBe(false);
    expect(r.exclusionReason).toBe('sem_amostras_validas');
  });
  it('amostragem de 5 s (nao assume 1 Hz): pico de 5 s e um evento de 5 s', () => {
    const points = base().filter((p) => p.offsetSec % 5 === 0).map((p) => ({ ...p, speedKmh: p.offsetSec >= 1000 && p.offsetSec < 1005 ? 30 : p.speedKmh }));
    const r = computeHrDecoupling(points);
    expect(r.eligible).toBe(true);
    expect(r.transientEventCount).toBe(1);
    expect(r.transientEventSec).toBe(5);
  });
});

describe('Cenario G — assimetria entre as metades', () => {
  it('exclusoes concentradas numa metade: nao considera o desacoplamento valido', () => {
    const r = computeHrDecoupling(eventsAt(base(), [300, 600, 900, 1200], 8, 2));
    expect(r.eligible).toBe(false);
    expect(r.exclusionReason).toBe('exclusoes_assimetricas');
  });
  it('as mesmas exclusoes distribuidas nas duas metades passam', () => {
    const r = computeHrDecoupling(eventsAt(base(), [600, 1200, 2400, 3000], 8, 2));
    expect(r.eligible).toBe(true);
    expect(r.qualityStatus).toBe('valid_with_caveats');
  });
});

describe('Auditoria e compatibilidade', () => {
  it('corrida estavel e VALIDA, sem ressalvas', () => {
    const r = computeHrDecoupling(base());
    expect(r.qualityStatus).toBe('valid');
    expect(r.transientEventCount).toBe(0);
    expect(r.excludedPct).toBe(0);
  });
  it('registra duracao analisada, eventos, tempo excluido e percentual; versao do algoritmo e 2', () => {
    const r = computeHrDecoupling(eventsAt(base(), [600, 2400], 6, 25));
    expect(HR_DECOUPLING_ALGORITHM_VERSION).toBe(2);
    expect(r.analyzedEndSec! - r.analyzedStartSec!).toBe(SECONDS);
    expect(r.transientEventCount).toBe(2);
    expect(r.transientEventSec).toBe(12);
    expect(r.excludedSec).toBe(2 * (6 + HR_DECOUPLING_PARAMS.hrStabilizationSec));
    expect(r.excludedPct).toBeCloseTo((100 * r.excludedSec!) / SECONDS, 8);
  });
  it('nao altera os dados originais da atividade', () => {
    const points = setSpeed(base(), 1000, 4, 30);
    const copy = JSON.stringify(points);
    computeHrDecoupling(points);
    expect(JSON.stringify(points)).toBe(copy);
  });
  it('os criterios de estabilidade (CV 10% e metades 5%) continuam valendo para o que nao e transitorio', () => {
    const alternating = base().map((p) => ({ ...p, speedKmh: p.offsetSec % 2 === 0 ? 14 : 6 }));
    expect(computeHrDecoupling(alternating).eligible).toBe(false);
  });
  it('todo motivo de exclusao tem texto para o painel', () => {
    for (const reason of ['interrupcao_acima_da_tolerancia', 'eventos_acima_do_limite_acumulado', 'padrao_sistematico_de_eventos', 'exclusoes_assimetricas'] as const) {
      expect(HR_DECOUPLING_REASON_TEXT[reason].length).toBeGreaterThan(10);
    }
  });
});
