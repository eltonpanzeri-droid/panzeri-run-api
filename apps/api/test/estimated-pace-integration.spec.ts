import * as fs from 'fs';
import * as path from 'path';
import { analyzeRunExecution } from '../src/activity-execution/execution-analysis';
import { renderSessionReport } from '../src/activity-execution/execution-report';
import { ESTIMATED_PACE_AI_NOTE, ESTIMATED_PACE_STUDENT_NOTE, loadRunPoints } from '../src/activity-execution/run-points-loader';

// Ritmo estimado pelo GPS (13/11/2026) — leitura, analise da faixa, textos e travas. Banco FALSO (so' leitura: qualquer escrita lancaria).
const M_PER_DEG = 111_195;
const routeRows = (seconds: number, step: number, mps: number) => {
  const rows: any[] = [];
  for (let t = 0; t <= seconds; t += step) rows.push({ offsetSec: t, distanceMeters: null, heartRateBpm: null, speedKmh: null, cadenceSpm: null, latitude: 0, longitude: (mps * t) / M_PER_DEG });
  return rows;
};
const fakePrisma = (rows: any[]) => ({ activityTimeSeriesPoint: { findMany: jest.fn(async () => rows) } }) as never;
const PACE_SEC = 340; // 5:40/km
const MPS = 1000 / PACE_SEC;

describe('loadRunPoints', () => {
  it('sem distancia/ritmo medidos e COM percurso: devolve o ritmo estimado; sem permissao do cliente (app antigo), nao', async () => {
    const rows = routeRows(1020, 3, MPS);
    const on = await loadRunPoints(fakePrisma(rows), 'a1', 1, null, { allowEstimate: true });
    expect(on.paceSource).toBe('gps_estimated');
    expect(on.points.length).toBeGreaterThan(900);
    expect(on.points.some((p) => p.speedKmh != null)).toBe(true);
    const off = await loadRunPoints(fakePrisma(rows), 'a1', 1, null, { allowEstimate: false });
    expect(off.paceSource).toBeNull();
    expect(off.points.every((p) => p.distanceMeters == null && p.speedKmh == null)).toBe(true); // exatamente como antes
  });

  it('com serie MEDIDA (distancia ou ritmo) o estimado NUNCA entra, mesmo havendo percurso', async () => {
    const rows = routeRows(300, 3, MPS);
    rows.push({ offsetSec: 10.5, distanceMeters: 30, heartRateBpm: 150, speedKmh: 10, cadenceSpm: null, latitude: null, longitude: null });
    const loaded = await loadRunPoints(fakePrisma(rows), 'a1', 1, null, { allowEstimate: true });
    expect(loaded.paceSource).toBe('measured');
    expect(loaded.points).toHaveLength(rows.length);
  });

  it('sem percurso suficiente ou sem linhas: nada e inventado; FC medida acompanha o estimado; GPS que discorda do total medido (>25%) e recusado', async () => {
    expect((await loadRunPoints(fakePrisma([]), 'a1', 1, null, { allowEstimate: true })).paceSource).toBeNull();
    expect((await loadRunPoints(fakePrisma(routeRows(30, 3, MPS)), 'a1', 1, null, { allowEstimate: true })).paceSource).toBeNull();
    const rows = routeRows(600, 3, MPS);
    rows.push({ offsetSec: 100, distanceMeters: null, heartRateBpm: 151, speedKmh: null, cadenceSpm: null, latitude: null, longitude: null });
    const withHr = await loadRunPoints(fakePrisma(rows), 'a1', 1, null, { allowEstimate: true });
    expect(withHr.points.find((p) => p.offsetSec === 100)?.heartRateBpm).toBe(151);
    expect((await loadRunPoints(fakePrisma(routeRows(600, 3, MPS)), 'a1', 1, MPS * 600 * 2, { allowEstimate: true })).paceSource).toBeNull();
  });
});

describe('analise da faixa com o ritmo estimado', () => {
  const structure = { blocks: [{ label: 'Principal', distanceValue: 3, distanceUnit: 'km', paceRange: '5:30/km a 5:50/km' }] };
  it('ritmo dentro da faixa vira PERCENTUAL alto na analise (como com a serie medida) e o texto avisa que e estimado', async () => {
    const loaded = await loadRunPoints(fakePrisma(routeRows(1020, 3, MPS)), 'a1', 1, null, { allowEstimate: true });
    const analysis = analyzeRunExecution({
      structure, prescribedDistanceKm: 3, prescribedDurationMin: 17, points: loaded.points as never,
      activity: { distanceMeters: 3000, durationSec: 1020, avgHeartRateBpm: 150, cadenceAvg: 170 }, completion: null,
    });
    expect(analysis.dataLevel).toBe('series');
    const overall = analysis.intensity.overall;
    expect(overall?.inPct).toBeGreaterThan(90);
    const estimated = { ...analysis, paceSource: 'gps_estimated' as const };
    const lines = renderSessionReport(estimated);
    expect(lines).toContain(ESTIMATED_PACE_STUDENT_NOTE);
    expect(lines.some((line) => /\d+%/.test(line))).toBe(true); // continua em percentual
    expect(renderSessionReport(analysis)).not.toContain(ESTIMATED_PACE_STUDENT_NOTE); // medido: sem aviso
  });

  it('textos aprovados: aluna (relogio nao entregou, calculo indireto, mais erros, sem recordes) e IA (nao usar para recordes)', () => {
    for (const piece of ['não entregou o ritmo', 'de forma indireta', 'mais erros', 'não é usado para contabilizar recordes pessoais']) expect(ESTIMATED_PACE_STUDENT_NOTE).toContain(piece);
    expect(ESTIMATED_PACE_AI_NOTE).toMatch(/recordes pessoais/);
    expect(ESTIMATED_PACE_AI_NOTE).toMatch(/menos preciso/);
  });
});

describe('travas: o estimado nunca vaza para recordes, desacoplamento, carga ou gravacao', () => {
  const src = (relative: string) => fs.readFileSync(path.join(__dirname, '..', 'src', relative), 'utf8');
  it('recordes e desacoplamento da FC nao usam o estimado; o estimador nao grava nada', () => {
    for (const file of ['best-marks/best-marks.service.ts', 'training-intelligence/hr-decoupling-store.ts', 'training-intelligence/hr-decoupling.ts']) {
      expect(src(file)).not.toContain('gps-estimated-pace');
      expect(src(file)).not.toContain('run-points-loader');
    }
    const estimator = src('activity-execution/gps-estimated-pace.ts') + src('activity-execution/run-points-loader.ts');
    expect(estimator).not.toMatch(/\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\(/);
  });
  it('so a leitura do detalhe e a analise usam o estimado; o detalhe so o entrega a quem pede (?pace=estimated)', () => {
    const detail = src('activity-execution/activity-detail.service.ts');
    expect(detail).toContain('options.allowEstimatedPace === true');
    const controller = src('activity-execution/activity-execution.controller.ts');
    expect(controller).toContain("allowEstimatedPace: pace === 'estimated'");
    expect(src('activity-execution/execution-analysis.service.ts')).toContain('ESTIMATED_PACE_AI_NOTE');
  });
});

describe('app: grafico e aviso do ritmo estimado', () => {
  const mobile = (relative: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', relative), 'utf8');
  it('o app pede o ritmo estimado, mostra o texto informativo e desenha a linha tracejada com legenda', () => {
    expect(mobile('App.tsx')).toContain('/detail?pace=estimated`');
    const detail = mobile('src/activityDetail.tsx');
    expect(detail).toContain("detail.paceSource === 'gps_estimated' && detail.paceNote");
    expect(detail).toContain("strokeDasharray={estimated ? '6,3' : undefined}");
    expect(detail).toContain('linha tracejada: ritmo estimado pelo GPS (menos preciso)');
    expect(detail).toContain("estimated={detail.paceSource === 'gps_estimated'}");
  });
});
