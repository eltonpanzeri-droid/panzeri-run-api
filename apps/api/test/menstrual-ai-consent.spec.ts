import { BadRequestException } from '@nestjs/common';
import { CYCLE_AI_CONSENT_VERSION, cycleAiConsentHash, isCycleAiConsentCurrent } from '../src/menstrual-cycle/menstrual-ai-consent';
import { MenstrualCycleService } from '../src/menstrual-cycle/menstrual-cycle.service';

// 10/11/2026: o ciclo so vai a IA com aceite vigente (versao + hash do texto), retirada independente.
describe('aceite do ciclo para a IA', () => {
  const row = (extra: Record<string, unknown> = {}) => ({ version: CYCLE_AI_CONSENT_VERSION, textHash: cycleAiConsentHash(), acceptedAt: new Date(), revokedAt: null, ...extra }) as any;

  it('vigente so com versao e hash de hoje e sem retirada', () => {
    expect(isCycleAiConsentCurrent(row())).toBe(true);
    expect(isCycleAiConsentCurrent(null)).toBe(false);
    expect(isCycleAiConsentCurrent(row({ revokedAt: new Date() }))).toBe(false);
    expect(isCycleAiConsentCurrent(row({ version: '2026-01-01.1' }))).toBe(false);
    expect(isCycleAiConsentCurrent(row({ textHash: 'outro' }))).toBe(false);
  });

  function build(stored: any) {
    const state = { row: stored as any };
    const prisma: any = {
      menstrualAiConsent: {
        findUnique: jest.fn(async () => state.row),
        upsert: jest.fn(async (args: any) => { state.row = state.row ? { ...state.row, ...args.update } : { ...args.create, revokedAt: null }; return state.row; }),
        updateMany: jest.fn(async (args: any) => { if (state.row && state.row.revokedAt === null) state.row = { ...state.row, ...args.data }; return { count: 1 }; }),
      },
    };
    return { service: new MenstrualCycleService(prisma, {} as any, {} as any), state, prisma };
  }

  it('sem aceite o servico NAO entrega o ciclo a IA (nem consulta o resto)', async () => {
    const { service } = build(null);
    (service as any).getProfile = jest.fn(async () => { throw new Error('nao deveria ler o perfil sem aceite'); });
    expect(await service.getAgentContext('u1')).toBeNull();
  });

  it('aceitar exige o texto vigente; retirar tira a autorizacao; texto antigo pede de novo', async () => {
    const { service, state } = build(null);
    const current = await service.getAiConsent('u1');
    expect(current).toMatchObject({ accepted: false, needsReconfirmation: false, version: CYCLE_AI_CONSENT_VERSION });
    await expect(service.acceptAiConsent('u1', { version: current.version, textHash: 'errado' })).rejects.toBeInstanceOf(BadRequestException);
    expect(state.row).toBeNull();
    expect((await service.acceptAiConsent('u1', { version: current.version, textHash: current.textHash })).accepted).toBe(true);
    expect((await service.revokeAiConsent('u1')).accepted).toBe(false);
    expect(state.row.revokedAt).not.toBeNull();
    await service.acceptAiConsent('u1', { version: current.version, textHash: current.textHash });
    expect(state.row.revokedAt).toBeNull();
    state.row = { ...state.row, version: '2026-01-01.1' };
    expect(await service.getAiConsent('u1')).toMatchObject({ accepted: false, needsReconfirmation: true });
  });
});
