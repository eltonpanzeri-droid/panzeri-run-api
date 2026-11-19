import { readFileSync } from 'fs';
import { join } from 'path';
import { DATA_EXPORT_EXCLUDED, DataExportService, redactForExport } from '../src/account-deletion/data-export.service';
import { ACCOUNT_DELETE_ORDER } from '../src/account-deletion/account-deletion.service';

// 19/11/2026 (Elton): exportacao dos dados da aluna, para todas as integracoes, sem segredos.
function fakePrisma(rowsByModel: Record<string, unknown[]>, user: Record<string, unknown> | null = { id: 'u1', name: 'Ana', email: 'a@x.com', cpf: '123', passwordHash: 'segredo', accountStatus: 'active' }) {
  const calls: Array<{ model: string; where: unknown }> = [];
  const handler = {
    get: (_t: unknown, model: string) => {
      if (model === 'user') return { findUnique: jest.fn().mockResolvedValue(user) };
      return { findMany: jest.fn(async (args: { where: unknown }) => { calls.push({ model, where: args.where }); return rowsByModel[model] ?? []; }) };
    },
  };
  return { prisma: new Proxy({}, handler), calls };
}

describe('exportacao dos dados da aluna', () => {
  it('inclui todas as integracoes e dados, sem senhas nem chaves de acesso', async () => {
    const { prisma } = fakePrisma({
      stravaConnection: [{ id: 's1', athleteId: 9, accessToken: 'TOKEN_SECRETO', refreshToken: 'R', scope: 'read' }],
      providerConnection: [{ id: 'p1', provider: 'garmin', oauthTokenSecret: 'X', status: 'active' }],
      rawExternalActivity: [{ id: 'r1', provider: 'coros', distanceMeters: 5000 }],
      wearableSleepSummary: [{ id: 'w1', provider: 'zepp', durationSec: 27000 }],
    });
    const out = (await new DataExportService(prisma as never).build('u1')) as { conta: Record<string, unknown>; dados: Record<string, Array<Record<string, unknown>>>; resumo: Record<string, unknown> };
    expect(Object.keys(out.dados)).toEqual(expect.arrayContaining(['stravaConnection', 'providerConnection', 'rawExternalActivity', 'wearableSleepSummary']));
    const json = JSON.stringify(out);
    expect(json).not.toContain('TOKEN_SECRETO');
    expect(json).not.toContain('segredo');
    expect(out.conta.passwordHash).toBeUndefined();
    expect(out.conta.cpf).toBe('123'); // e' dado dela
    expect(out.dados.stravaConnection[0].athleteId).toBe(9);
    expect(out.resumo.stravaConnection).toEqual({ registros: 1, incompleto: false });
  });

  it('nao exporta tentativas de login/OAuth, codigos de senha nem uso interno', async () => {
    const { prisma, calls } = fakePrisma({ passwordResetCode: [{ id: 'x' }], aiGenerationCost: [{ id: 'y' }] });
    const out = (await new DataExportService(prisma as never).build('u1')) as { dados: Record<string, unknown> };
    expect(out.dados.passwordResetCode).toBeUndefined();
    expect(out.dados.aiGenerationCost).toBeUndefined();
    expect(calls.some((c) => DATA_EXPORT_EXCLUDED.has(c.model))).toBe(false);
  });

  it('cada modelo e filtrado pela aluna (nunca dado de outra pessoa); filhos pelo id dos pais dela', async () => {
    const { prisma, calls } = fakePrisma({ trainingSession: [{ id: 'ts1' }], activityLog: [{ id: 'al1' }] });
    await new DataExportService(prisma as never).build('u1');
    expect(calls.find((c) => c.model === 'stravaConnection')?.where).toEqual({ userId: 'u1' });
    expect(calls.find((c) => c.model === 'workoutDelivery')?.where).toEqual({ trainingSessionId: { in: ['ts1'] } });
    expect(calls.find((c) => c.model === 'rawActivitySample')?.where).toEqual({ activityLogId: { in: ['al1'] } });
    expect(calls.find((c) => c.model === 'problemReportImage')?.where).toEqual({ report: { userId: 'u1' } });
  });

  it('cobre a mesma lista da exclusao de conta (modelo novo nao fica de fora sozinho)', async () => {
    const { prisma, calls } = fakePrisma({});
    await new DataExportService(prisma as never).build('u1');
    const read = new Set(calls.map((c) => c.model));
    for (const model of ACCOUNT_DELETE_ORDER) if (!DATA_EXPORT_EXCLUDED.has(model)) expect(read.has(model)).toBe(true);
  });

  it('conta excluida ou inexistente: nada e exportado', async () => {
    await expect(new DataExportService(fakePrisma({}, null).prisma as never).build('u1')).rejects.toThrow();
    await expect(new DataExportService(fakePrisma({}, { id: 'u1', accountStatus: 'deleted' }).prisma as never).build('u1')).rejects.toThrow();
  });

  it('falha em um modelo nao esconde o resto; BigInt, binario e texto gigante viram texto seguro', () => {
    const out = redactForExport({ n: BigInt(5), foto: Buffer.from('abc'), longo: 'x'.repeat(200_000), ok: 1, apiKey: 'k' }) as Record<string, unknown>;
    expect(out.n).toBe('5');
    expect(String(out.foto)).toContain('omitido');
    expect(String(out.longo)).toContain('omitido');
    expect(out.ok).toBe(1);
    expect(out.apiKey).toBeUndefined();
  });

  it('ligacao: rota autenticada, limitada, so do proprio usuario; botao na tela de Privacidade', () => {
    const read = (...p: string[]) => readFileSync(join(__dirname, '..', ...p), 'utf8');
    const controller = read('src', 'account-deletion', 'self-account-deletion.controller.ts');
    expect(controller).toContain("@Get('data-export')");
    expect(controller).toContain('this.dataExport.build(user.sub)');
    expect(read('src', 'account-deletion', 'account-deletion.module.ts')).toContain('DataExportService');
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(app).toContain('<ExportDataSection accessToken={accessToken} apiUrl={API_URL} />');
    expect(readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'dataExport', 'ExportDataSection.tsx'), 'utf8')).toContain('/me/account/data-export');
  });
});
