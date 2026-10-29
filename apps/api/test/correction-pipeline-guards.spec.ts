import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Logger } from '@nestjs/common';
import { correctionHooks, CorrectionContext, scopeOfDates, weekStartOf } from '../src/activity-execution/correction-hooks';
import { ProviderDataDeletionService } from '../src/activity-execution/provider-data-deletion.service';
import { registerMedalProcessor, waitForPendingContinuations } from '../src/activity-execution/pending-reevaluation';
import { LINK_CORRECTION_INSTRUCTION, PrescriptionAgentService, REASONING_INSTRUCTION } from '../src/training-plans/prescription-agent.service';
import { EvolutionAgentService } from '../src/reassessment/evolution-agent.service';
import { pendingModel } from './helpers/pending-fake';

// Guardas do conjunto: ganchos isolados, exclusao de dados do provedor (ausencia nao e prova), nenhuma geracao de treino por correcao, prompts com a regra de
// precedencia da informacao corrigida e migracao ADITIVA com conversao idempotente das retracoes antigas (validacao ESTRUTURAL do arquivo — nao execucao).

jest.mock('../src/activity-execution/execution-analysis.service', () => ({ ExecutionAnalysisService: class { analyzeSession = jest.fn(); } }));

const src = (...parts: string[]) => readFileSync(join(__dirname, '..', 'src', ...parts), 'utf8');
const ctx = (extra: Partial<CorrectionContext> = {}): CorrectionContext => ({ userId: 'u1', kind: 'link_correction', origin: 'student', actorId: 'u1', at: new Date(), since: null, sessionIds: [], activityLogIds: [], completionsChanged: false, changes: [], affectedDates: [], ...extra });

afterEach(async () => { await waitForPendingContinuations(); correctionHooks.clear(); registerMedalProcessor(null); jest.restoreAllMocks(); });

describe('ganchos pos-correcao', () => {
  it('executam em sequencia e a falha de um NAO interrompe os demais nem propaga', async () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const order: string[] = [];
    correctionHooks.register('a', async () => { order.push('a'); });
    correctionHooks.register('quebra', async () => { order.push('quebra'); throw new Error('falhou'); });
    correctionHooks.register('c', async () => { order.push('c'); });
    await expect(correctionHooks.run(ctx())).resolves.toBeUndefined();
    expect(order).toEqual(['a', 'quebra', 'c']);
  });

  it('registrar de novo o mesmo nome SUBSTITUI (reiniciar modulo nao duplica)', async () => {
    const calls: string[] = [];
    correctionHooks.register('x', async () => { calls.push('1'); });
    correctionHooks.register('x', async () => { calls.push('2'); });
    await correctionHooks.run(ctx());
    expect(calls).toEqual(['2']);
  });

  it('escopo de semanas/meses: segunda-feira ISO e mes de cada data afetada', () => {
    expect(weekStartOf('2026-10-11')).toBe('2026-10-05'); // domingo pertence a semana que comecou na segunda anterior
    expect(weekStartOf('2026-10-12')).toBe('2026-10-12');
    expect(scopeOfDates(['2026-10-11', '2026-09-30', 'lixo', '2026-10-05T10:00:00Z'])).toEqual({ weeks: ['2026-09-28', '2026-10-05'], months: ['2026-09', '2026-10'] });
  });
});

describe('exclusao de dados do provedor: atualiza indicadores/medalhas, mas ausencia de dado nao e prova', () => {
  it('apos a exclusao executa os ganchos com absenceOfData=true (datas e sessoes afetadas) e o resultado devolvido nao vaza o detalhe interno', async () => {
    const pending = pendingModel();
    const prisma: any = { correctionReevaluation: pending.model };
    const ledger = { record: jest.fn(async () => undefined), alert: jest.fn() };
    const service = new ProviderDataDeletionService(prisma, ledger as never);
    jest.spyOn(service, 'executeProviderDataDeletion').mockResolvedValue({
      provider: 'polar', activities: 3, rawActivities: 3, samples: 0, timeSeriesPoints: 0, executionLinks: 2, notifications: 0, syntheticSessions: 1, preservedMaterialized: [],
      affected: { sessionIds: ['s1', 's2'], dates: ['2026-10-05', '2026-10-06'], completionsChanged: true },
    } as never);
    const seen: CorrectionContext[] = [];
    correctionHooks.register('espiao', async (c) => { seen.push(c); });
    const result = await service.deleteProviderData('u1', 'polar');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ kind: 'provider_data_deleted', origin: 'system', absenceOfData: true, provider: 'polar', completionsChanged: true, sessionIds: ['s1', 's2'], affectedDates: ['2026-10-05', '2026-10-06'], changes: [] });
    expect((result as unknown as Record<string, unknown>).affected).toBeUndefined();
    expect(result.activities).toBe(3);
  });

  it('falha na atualizacao posterior nao faz a exclusao falhar (ja concluida) e e registrada', async () => {
    const errorSpy = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    const service = new ProviderDataDeletionService({} as never, { record: jest.fn(async () => undefined), alert: jest.fn() } as never);
    jest.spyOn(service, 'executeProviderDataDeletion').mockResolvedValue({ provider: 'polar', activities: 1, affected: { sessionIds: [], dates: [], completionsChanged: false } } as never);
    correctionHooks.register('quebra', async () => { throw new Error('gancho fora'); });
    await expect(service.deleteProviderData('u1', 'polar')).resolves.toMatchObject({ provider: 'polar' });
    expect(errorSpy).toHaveBeenCalled();
  });
});

describe('correcao nunca gera treino nem aciona o Prescritor', () => {
  const files = ['activity-execution/correction-hooks.ts', 'activity-execution/pending-reevaluation.ts', 'activity-execution/analysis-recompute.ts', 'activity-execution/pending-reevaluation-sweeper.service.ts',
    'medals/medal-award-decision.ts', 'medals/medal-award-persistence.ts', 'medals/medal-evaluation.service.ts', 'training-plans/correction-event.ts'];

  it.each(files)('%s nao importa nem chama servicos de geracao/prescricao', (file) => {
    const text = src(file);
    expect(text).not.toMatch(/generateWeek|regenerateSession|regenerateStudentWeek|PrescriptionAgentService|TrainingPlansService|technical-manager/);
  });

  it('o ponto central so reanalisa (determinista) e dispara ganchos; nao importa o modulo de planos', () => {
    const link = src('activity-execution/session-execution-link.service.ts');
    const region = link.slice(link.indexOf('async recomputeAfterCorrection('), link.indexOf('private async hasActiveLinkForActivity'));
    expect(region).not.toMatch(/generateWeek|regenerateSession|PrescriptionAgent|TrainingPlans/);
    expect(link).not.toMatch(/from '\.\.\/training-plans\//);
  });
});

describe('prompts: a informacao corrigida prevalece sobre interpretacao historica', () => {
  const agent = new PrescriptionAgentService({ get: () => undefined } as never, {} as never) as unknown as Record<string, () => string>;

  it('o Prescritor (semana, dia de corrida e dia de forca) recebe o bloco, depois do raciocinio', () => {
    for (const build of ['buildSystemPromptStable', 'buildRunSessionSystemPrompt', 'buildSingleStrengthSystemPrompt']) {
      const prompt = agent[build]();
      expect(prompt).toContain(LINK_CORRECTION_INSTRUCTION);
      expect(prompt.indexOf(LINK_CORRECTION_INSTRUCTION)).toBeGreaterThan(prompt.indexOf(REASONING_INSTRUCTION));
    }
  });

  it('o bloco diz: prevalece, registro antigo e historico, dado estruturado e a referencia, nao e queixa, nao muda volume por si so, pondera pela idade, vale a mais recente', () => {
    expect(LINK_CORRECTION_INSTRUCTION).toMatch(/EXECUTION_LINK_CORRECTED/);
    expect(LINK_CORRECTION_INSTRUCTION).toMatch(/PREVALECE sobre qualquer interpretacao historica incompativel/);
    expect(LINK_CORRECTION_INSTRUCTION).toMatch(/continua existindo como HISTORICO/);
    expect(LINK_CORRECTION_INSTRUCTION).toMatch(/dados estruturados atuais .* sao a referencia factual/);
    expect(LINK_CORRECTION_INSTRUCTION).toMatch(/NAO e queixa, dor, desmotivacao/);
    expect(LINK_CORRECTION_INSTRUCTION).toMatch(/NAO e motivo para mudar volume ou intensidade/);
    expect(LINK_CORRECTION_INSTRUCTION).toMatch(/ponderacao temporal habitual/);
    expect(LINK_CORRECTION_INSTRUCTION).toMatch(/vale a mais recente/);
    expect(LINK_CORRECTION_INSTRUCTION).not.toMatch(/formula|porcentagem|fator/i); // nenhuma formula nova
  });

  it('o Condensador do Prontuario reconhece o evento: corrigido prevalece, antigo vai para TRAJETORIA datado, nao apaga, nao e queixa, nao copia Ref', () => {
    const condenser = new EvolutionAgentService({ get: () => undefined } as never, {} as never) as unknown as { buildProfileCondensationSystemPrompt: () => string };
    const prompt = condenser.buildProfileCondensationSystemPrompt();
    expect(prompt).toContain('EVENTOS EXECUTION_LINK_CORRECTED');
    expect(prompt).toMatch(/PREVALECE sobre qualquer trecho anterior do resumo/);
    expect(prompt).toMatch(/ESTADO ATUAL deve refletir SO o estado corrigido/);
    expect(prompt).toMatch(/TRAJETORIA registre de forma curta e datada/);
    expect(prompt).toMatch(/Nao apague o fato de a atividade ter existido/);
    expect(prompt).toMatch(/nao e queixa nem mudanca de condicao fisica/);
    expect(prompt).toMatch(/Nao copie os identificadores da linha "Ref"/);
    expect(prompt).toMatch(/vale a mais recente/);
  });

  it('a geracao semanal nao foi alterada: nenhuma das mudancas toca generateWeek (assinatura e chamadas do Prontuario/Analista intactas)', () => {
    const plans = src('training-plans/training-plans.service.ts');
    expect(plans).toMatch(/refreshProfileDetailed\(userId\)/); // condensacao so' na geracao semanal, como antes
    expect(plans).not.toMatch(/recomputeAfterCorrection|correctionHooks|processPendingReevaluation/);
  });
});

describe('migracao: aditiva, preserva registros e converte as retracoes antigas de forma idempotente (validacao estrutural, NAO execucao)', () => {
  const dir = join(__dirname, '..', 'prisma', 'migrations', '20261015120000_medal_award_transitions_and_pending_reevaluation');
  const sql = readFileSync(join(dir, 'migration.sql'), 'utf8');
  const schema = readFileSync(join(__dirname, '..', 'prisma', 'schema.prisma'), 'utf8');
  const code = sql.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');

  it('nenhuma instrucao destrutiva (DROP, TRUNCATE, DELETE, ALTER ... DROP/TYPE/RENAME)', () => {
    // "ON DELETE CASCADE" da FK nao e exclusao de dado: so' instrucoes DELETE de verdade contam
    expect(code).not.toMatch(/\bDROP\b|\bTRUNCATE\b|(?<!ON )\bDELETE\b|RENAME|ALTER COLUMN|DROP COLUMN/i);
  });

  it('colunas novas de UserAchievement: status com padrao, demais anulaveis (linhas existentes entram como "active")', () => {
    expect(code).toMatch(/ALTER TABLE "UserAchievement" ADD COLUMN\s+"revokedAt" TIMESTAMP\(3\)/);
    expect(code).toContain('"revokedReason" TEXT');
    expect(code).toContain(`"status" TEXT NOT NULL DEFAULT 'active'`);
    expect(code).toContain('"statusChangedAt" TIMESTAMP(3)');
  });

  it('cria as duas tabelas, indices e a FK com ON DELETE CASCADE (a exclusao de conta leva o historico junto)', () => {
    expect(code).toContain('CREATE TABLE "UserAchievementTransition"');
    expect(code).toContain('CREATE TABLE "CorrectionReevaluation"');
    expect(code).toContain('CREATE INDEX "UserAchievement_userId_status_idx"');
    expect(code).toMatch(/FOREIGN KEY \("userAchievementId"\) REFERENCES "UserAchievement"\("id"\) ON DELETE CASCADE/);
  });

  it('todo campo dos modelos novos do schema existe como coluna no SQL (sem divergencia entre schema e migracao)', () => {
    for (const model of ['UserAchievementTransition', 'CorrectionReevaluation']) {
      const body = schema.slice(schema.indexOf(`model ${model} {`)).split('\n}')[0];
      const fields = body.split('\n').slice(1).map((l) => l.trim()).filter((l) => l && !l.startsWith('//') && !l.startsWith('@@') && !l.includes('@relation'));
      const table = code.slice(code.indexOf(`CREATE TABLE "${model}"`)).split(');')[0];
      for (const line of fields) expect(table).toContain(`"${line.split(/\s+/)[0]}"`);
    }
    for (const column of ['status', 'statusChangedAt', 'revokedAt', 'revokedReason']) expect(schema).toMatch(new RegExp(`model UserAchievement \\{[\\s\\S]*?\\n  ${column}\\s`));
  });

  it('conversao das retracoes antigas: so linhas ativas com marcador "retracted"; o marcador e MANTIDO; historico inserido uma unica vez', () => {
    expect(code).toMatch(/UPDATE "UserAchievement"[\s\S]*SET "status" = 'revoked'/);
    expect(code).toMatch(/WHERE "status" = 'active'[\s\S]*'_volumeReconciliation'->>'status' = 'retracted'/);
    expect(code).not.toMatch(/"evidence"\s*=/); // o marcador nao e removido nem reescrito
    expect(code).toMatch(/INSERT INTO "UserAchievementTransition"[\s\S]*NOT EXISTS \(SELECT 1 FROM "UserAchievementTransition" t WHERE t\."userAchievementId" = ua\."id" AND t\."trigger" = 'migration_volume_retraction'\)/);
    expect(code).toContain(`ua."status" = 'revoked'`);
  });

  it('e a migration mais recente (ordem de aplicacao)', () => {
    const names = readdirSync(join(__dirname, '..', 'prisma', 'migrations')).filter((n: string) => /^\d{14}_/.test(n)).sort();
    expect(names).toContain('20261015120000_medal_award_transitions_and_pending_reevaluation') // migrations posteriores (ex.: cupons, 30/10/2026) sao aditivas;
  });

  it('a exclusao de conta cobre as tabelas novas (historico das transicoes e pendencia)', () => {
    const deletion = src('account-deletion/account-deletion.service.ts');
    expect(deletion).toContain("'userAchievementTransition'");
    expect(deletion).toContain("'correctionReevaluation'");
    expect(deletion.indexOf("'userAchievementTransition'")).toBeLessThan(deletion.indexOf("'userAchievement',"));
  });
});
