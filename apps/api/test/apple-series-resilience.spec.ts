import 'reflect-metadata';
import * as fs from 'fs';
import * as path from 'path';
import { BadRequestException } from '@nestjs/common';
import { AppleHealthIngestionService } from '../src/apple-health/apple-health-ingestion.service';
import { SERIES_EMPTY_MAX, nextEmptyAttempt } from '../../mobile/src/appleHealthSync/appleHealthSyncLogic';

// Series do Apple Saude (13/11/2026, caso Lorena): percurso chegou, mas FC/ritmo/cadencia/potencia/distancia nao. Duas protecoes: o app nao desiste na 1a leitura vazia nem depende das janelas de data,
// e relata ao servidor o que o iPhone entregou (diagnostico mostrado no painel).
const read = (relative: string) => fs.readFileSync(path.join(__dirname, '..', '..', 'mobile', relative), 'utf8');

describe('tentativas de series vazias (app)', () => {
  it('nao desiste na 1a leitura vazia; desiste na 3a; contagens por treino independentes', () => {
    let attempts: Record<string, number> = {};
    for (let i = 1; i < SERIES_EMPTY_MAX; i += 1) {
      const step = nextEmptyAttempt(attempts, 'a');
      attempts = step.attempts;
      expect(step.giveUp).toBe(false);
    }
    const last = nextEmptyAttempt(attempts, 'a');
    expect(last.giveUp).toBe(true);
    expect(nextEmptyAttempt(last.attempts, 'b')).toMatchObject({ giveUp: false });
    expect(attempts).toEqual({ a: SERIES_EMPTY_MAX - 1 });
  });

  it('o app reconfere treinos recentes (nao so os da janela), relata o diagnostico e nao marca "conferido" na 1a leitura vazia', () => {
    const card = read('src/appleHealthSync/AppleHealthSyncCard.tsx');
    expect(card).toContain("if (failure === null && granted.has('sensors')) {");
    expect(card).toContain('const seriesWorkouts = await withRecentWorkouts(workouts);');
    expect(card).toContain("'/apple-health/series/diagnostic'");
    expect(card).toContain('const step = nextEmptyAttempt(emptyAttempts, todo[index]);');
    expect(card).not.toContain('if (Object.keys(metrics).length === 0) { checked.add(todo[index]); continue; }');
  });
});

describe('diagnostico de series (servidor)', () => {
  function build(over: { count?: number } = {}) {
    const created: any[] = [];
    const prisma: any = { providerConnectionEvent: { count: jest.fn(async () => over.count ?? 0), create: jest.fn(async ({ data }: any) => { created.push(data); return data; }) } };
    return { service: new AppleHealthIngestionService(prisma), created };
  }

  it('grava so contagens das medidas conhecidas e um motivo curto limpo; nunca dado de saude', async () => {
    const { service, created } = build();
    const out = await service.recordSeriesDiagnostic('u1', { recordId: ' ABC-123 ', outcome: 'empty', counts: { heartRate: 0, runningSpeed: 12, hack: 99, distance: -3, stepCount: 'x' }, detail: 'tentativa 2 <script>alert(1)</script>' });
    expect(out).toEqual({ recorded: true });
    expect(created[0]).toMatchObject({ userId: 'u1', provider: 'apple_health', type: 'series_diagnostic' });
    expect(created[0].details.recordId).toBe('abc-123');
    expect(created[0].details.counts).toEqual({ heartRate: 0, runningSpeed: 12 });
    expect(created[0].details.detail).not.toMatch(/[<>]/);
  });

  it('recusa resultado/recordId invalidos; passa do limite diario sem gravar e sem erro', async () => {
    const { service, created } = build();
    await expect(service.recordSeriesDiagnostic('u1', { outcome: 'empty' })).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.recordSeriesDiagnostic('u1', { recordId: 'a', outcome: 'xx' })).rejects.toBeInstanceOf(BadRequestException);
    const limited = build({ count: 30 });
    await expect(limited.service.recordSeriesDiagnostic('u1', { recordId: 'a', outcome: 'empty' })).resolves.toEqual({ recorded: false });
    expect(limited.created).toHaveLength(0);
    expect(created).toHaveLength(0);
  });
});
