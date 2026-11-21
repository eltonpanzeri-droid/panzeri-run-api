import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { CanonicalCandidateInput, OWN_RECORDING_PROVIDER_ID, selectCanonicalObservation } from '../src/activity-execution/physical-canonical';
import { compareObservations, ObservedActivity } from '../src/activity-execution/physical-activity-identity';
import { PhysicalActivityIdentityService } from '../src/activity-execution/physical-activity-identity.service';
import { IdentityConfirmationService } from '../src/activity-execution/identity-confirmation.service';
import { PANZERI_RUN_PROVIDER_ID } from '../src/run-recording/run-consent';

// 21/11/2026 (Elton) — qual gravacao vale quando ha uma do proprio Panzeri Run. As regras que JA existiam nao mudam (manual so' vale sozinho; manual + relogio vale o relogio; dois relogios vale o de mais dados);
// a unica EXCECAO nova: com gravacao do Panzeri Run no evento, ela vale, a nao ser que a aluna escolha a de outra fonte. Estes testes cobrem as regras antigas (inalteradas) e a excecao.

const cand = (id: string, provider: string, over: Partial<CanonicalCandidateInput> = {}): CanonicalCandidateInput => ({
  id, provider, providerMetrics: provider === 'apple_health' ? { source: { bundleId: 'com.apple.health.x' }, device: { manufacturer: 'Apple', name: 'Apple Watch' } } : {},
  durationSec: 1800, distanceMeters: 5000, caloriesKcal: null, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null, powerAvgWatts: null, elevationGainMeters: null, hasRoute: null, ...over,
});
const watchRich = { avgHeartRateBpm: 150, maxHeartRateBpm: 175, cadenceAvg: 170, caloriesKcal: 400, elevationGainMeters: 30, hasRoute: true };

describe('constante da fonte', () => {
  it('o provedor do consentimento e o da escolha canonica sao o mesmo valor', () => {
    expect(OWN_RECORDING_PROVIDER_ID).toBe('panzeri_run');
    expect(PANZERI_RUN_PROVIDER_ID).toBe(OWN_RECORDING_PROVIDER_ID);
  });
});

describe('regras que ja existiam continuam como estavam (sem gravacao do Panzeri Run)', () => {
  it('dois relogios: vale o de mais dados', () => {
    const sel = selectCanonicalObservation([cand('a', 'garmin'), cand('b', 'polar', watchRich)])!;
    expect(sel.canonicalId).toBe('b');
    expect(sel.reason.rule).toBe('native_recorder');
    expect(sel.reason.tieBreak).toBe('completeness');
  });
  it('observacao unica vale; a marca de escolha da aluna e IGNORADA quando nao ha gravacao do Panzeri Run', () => {
    expect(selectCanonicalObservation([cand('a', 'garmin')])!.reason.rule).toBe('sole_observation');
    const withMark = selectCanonicalObservation([cand('a', 'garmin', { studentChoseThis: true }), cand('b', 'polar', watchRich)])!;
    const without = selectCanonicalObservation([cand('a', 'garmin'), cand('b', 'polar', watchRich)])!;
    expect(withMark.canonicalId).toBe(without.canonicalId);
    expect(withMark.reason.rule).toBe(without.reason.rule);
  });
});

describe('excecao: gravacao do proprio Panzeri Run', () => {
  it('Panzeri Run + relogio (mais completo): vale o Panzeri Run; o relogio fica como alternativa preservada', () => {
    const sel = selectCanonicalObservation([cand('watch', 'garmin', watchRich), cand('run', OWN_RECORDING_PROVIDER_ID)])!;
    expect(sel.canonicalId).toBe('run');
    expect(sel.reason.rule).toBe('own_recording');
    expect(sel.reason.nativeAlternatives).toEqual(['watch']);
    expect(sel.reason.candidates.map((c) => c.activityLogId).sort()).toEqual(['run', 'watch']); // nada some da auditoria
  });
  it('a aluna escolheu o relogio: vale o relogio (student_choice); o do Panzeri Run segue guardado', () => {
    const sel = selectCanonicalObservation([cand('watch', 'garmin', { ...watchRich, studentChoseThis: true }), cand('run', OWN_RECORDING_PROVIDER_ID)])!;
    expect(sel.canonicalId).toBe('watch');
    expect(sel.reason.rule).toBe('student_choice');
    expect(sel.reason.candidates).toHaveLength(2);
  });
  it('a marca em cima da PROPRIA gravacao do Panzeri Run nao muda nada (e o padrao)', () => {
    const sel = selectCanonicalObservation([cand('watch', 'garmin'), cand('run', OWN_RECORDING_PROVIDER_ID, { studentChoseThis: true })])!;
    expect(sel.canonicalId).toBe('run');
    expect(sel.reason.rule).toBe('own_recording');
  });
  it('gravacao do Panzeri Run INVALIDA (sem duracao nem distancia) nao ganha: segue a regra de sempre', () => {
    const sel = selectCanonicalObservation([cand('watch', 'garmin', watchRich), cand('run', OWN_RECORDING_PROVIDER_ID, { durationSec: null, distanceMeters: null })])!;
    expect(sel.canonicalId).toBe('watch');
    expect(sel.reason.rule).toBe('native_recorder');
  });
  it('escolha da aluna sobre observacao invalida e ignorada', () => {
    const sel = selectCanonicalObservation([cand('watch', 'garmin', { durationSec: null, distanceMeters: null, studentChoseThis: true }), cand('run', OWN_RECORDING_PROVIDER_ID)])!;
    expect(sel.canonicalId).toBe('run');
  });
  it('duas gravacoes do Panzeri Run no mesmo evento: a mais completa; depois o id (resultado independe da ordem)', () => {
    const a = cand('r1', OWN_RECORDING_PROVIDER_ID);
    const b = cand('r2', OWN_RECORDING_PROVIDER_ID, { elevationGainMeters: 10 });
    expect(selectCanonicalObservation([a, b])!.canonicalId).toBe('r2');
    expect(selectCanonicalObservation([b, a])!.canonicalId).toBe('r2');
    expect(selectCanonicalObservation([cand('r9', OWN_RECORDING_PROVIDER_ID), cand('r1', OWN_RECORDING_PROVIDER_ID)])!.reason.tieBreak).toBe('id');
  });
  it('a ordem de chegada nunca muda o resultado (Panzeri Run + dois relogios)', () => {
    const set = [cand('g', 'garmin', watchRich), cand('p', 'polar'), cand('run', OWN_RECORDING_PROVIDER_ID)];
    const ids = [set, [...set].reverse(), [set[1], set[2], set[0]]].map((s) => selectCanonicalObservation(s)!.canonicalId);
    expect(new Set(ids)).toEqual(new Set(['run']));
  });
});

describe('o mesmo treino gravado no celular e no relogio e reconhecido como UM evento (identidade)', () => {
  const at = (iso: string) => new Date(iso);
  const phone: ObservedActivity = { id: 'run', userId: 'u1', provider: 'panzeri_run', sport: 'corrida', startedAt: at('2026-11-21T09:00:00Z'), durationSec: 1800, distanceMeters: 5000, endedAt: null, observerKey: 'panzeri_run' };
  it('inicio ~20 s depois no relogio, distancia ~2,5% maior (GPS do celular x relogio): mesma execucao', () => {
    const watch: ObservedActivity = { ...phone, id: 'w', provider: 'garmin', observerKey: 'garmin', startedAt: at('2026-11-21T09:00:20Z'), durationSec: 1795, distanceMeters: 5125 };
    expect(compareObservations(phone, watch).verdict).toBe('same');
    expect(compareObservations(watch, phone).verdict).toBe('same');
  });
  it('treinos em horarios diferentes no mesmo dia nao sao o mesmo evento', () => {
    const evening: ObservedActivity = { ...phone, id: 'w', provider: 'garmin', observerKey: 'garmin', startedAt: at('2026-11-21T21:00:00Z') };
    expect(compareObservations(phone, evening).verdict).toBe('distinct');
  });
});

// ---- servico: escolha da aluna, com banco em memoria
type Row = Record<string, unknown> & { id: string; userId: string; provider: string };
function serviceHarness(rows: Row[]) {
  const data = new Map(rows.map((r) => [r.id, { ...r }]));
  const activityLog = {
    findFirst: jest.fn(async ({ where }: { where: { id: string; userId: string } }) => { const r = data.get(where.id); return r && r.userId === where.userId ? { ...r } : null; }),
    findMany: jest.fn(async ({ where }: { where: { userId: string; physicalEventId: string; physicalIdentityStatus?: string } }) =>
      [...data.values()].filter((r) => r.userId === where.userId && r.physicalEventId === where.physicalEventId && (!where.physicalIdentityStatus || r.physicalIdentityStatus === where.physicalIdentityStatus)).map((r) => ({ ...r }))),
    update: jest.fn(async ({ where, data: patch }: { where: { id: string }; data: Record<string, unknown> }) => Object.assign(data.get(where.id)!, patch)),
  };
  const tx = { $executeRaw: jest.fn(async () => 1), activityLog, athletePrimarySource: { findFirst: jest.fn(async () => null) }, workoutDelivery: { findFirst: jest.fn(async () => null) } };
  const prisma = { activityLog, $transaction: jest.fn(async (fn: (t: typeof tx) => Promise<unknown>) => fn(tx)) };
  return { service: new PhysicalActivityIdentityService(prisma as never), data, activityLog };
}
const log = (id: string, provider: string, over: Record<string, unknown> = {}): Row => ({
  id, userId: 'u1', provider, sport: 'corrida', startedAt: new Date('2026-11-21T09:00:00Z'), durationSec: 1800, distanceMeters: 5000, caloriesKcal: null, avgHeartRateBpm: null, maxHeartRateBpm: null, cadenceAvg: null,
  powerAvgWatts: null, elevationGainMeters: null, hasRoute: null, providerMetrics: {}, physicalEventId: 'ev1', physicalIdentityStatus: 'matched', physicalCanonicalActivityLogId: null, physicalCanonicalReason: null,
  physicalIdentityEvidence: null, studentCanonicalChoiceAt: null, ...over,
});

describe('escolha da aluna (servico de identidade)', () => {
  it('padrao: a gravacao do Panzeri Run e a canonica; escolher o relogio troca; desfazer volta ao padrao', async () => {
    const h = serviceHarness([log('run', 'panzeri_run'), log('watch', 'garmin', { avgHeartRateBpm: 150, cadenceAvg: 170 })]);
    const first = await h.service.setStudentCanonicalChoice('u1', 'watch', false);
    expect(h.data.get('run')!.physicalCanonicalActivityLogId).toBe('run');
    expect(h.data.get('watch')!.physicalCanonicalActivityLogId).toBe('run');
    expect(first.affectedActivityLogIds.length).toBeGreaterThan(0);

    const chosen = await h.service.setStudentCanonicalChoice('u1', 'watch', true);
    expect(h.data.get('watch')!.studentCanonicalChoiceAt).toBeInstanceOf(Date);
    expect(h.data.get('run')!.studentCanonicalChoiceAt).toBeNull();
    expect(h.data.get('run')!.physicalCanonicalActivityLogId).toBe('watch');
    expect((h.data.get('run')!.physicalCanonicalReason as { rule: string }).rule).toBe('student_choice');
    expect(chosen.affectedActivityLogIds.sort()).toEqual(['run', 'watch']);

    const again = await h.service.setStudentCanonicalChoice('u1', 'watch', true); // repetir e idempotente
    expect(again.affectedActivityLogIds).toEqual([]);

    await h.service.setStudentCanonicalChoice('u1', 'watch', false);
    expect(h.data.get('watch')!.studentCanonicalChoiceAt).toBeNull();
    expect(h.data.get('run')!.physicalCanonicalActivityLogId).toBe('run');
    // nenhum dado de nenhuma gravacao foi tocado
    expect(h.data.get('run')!.distanceMeters).toBe(5000);
    expect(h.data.get('watch')!.avgHeartRateBpm).toBe(150);
  });

  it('escolher a propria gravacao do Panzeri Run equivale a desfazer (nao deixa marca)', async () => {
    const h = serviceHarness([log('run', 'panzeri_run'), log('watch', 'garmin')]);
    await h.service.setStudentCanonicalChoice('u1', 'watch', true);
    await h.service.setStudentCanonicalChoice('u1', 'run', true);
    expect(h.data.get('watch')!.studentCanonicalChoiceAt).toBeNull();
    expect(h.data.get('run')!.physicalCanonicalActivityLogId).toBe('run');
  });

  it('so existe escolha quando ha gravacao do Panzeri Run no evento; atividade de outra conta = 404; sem evento = 400', async () => {
    const noRun = serviceHarness([log('a', 'garmin'), log('b', 'polar')]);
    await expect(noRun.service.setStudentCanonicalChoice('u1', 'a', true)).rejects.toBeInstanceOf(BadRequestException);
    expect(noRun.data.get('a')!.studentCanonicalChoiceAt).toBeNull();
    const other = serviceHarness([log('run', 'panzeri_run'), log('watch', 'garmin')]);
    await expect(other.service.setStudentCanonicalChoice('intruso', 'watch', true)).rejects.toBeInstanceOf(NotFoundException);
    const alone = serviceHarness([log('solo', 'garmin', { physicalEventId: null, physicalIdentityStatus: 'unique' })]);
    await expect(alone.service.setStudentCanonicalChoice('u1', 'solo', true)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('a conta e a reconciliacao: o servico de confirmacao reconcilia so os ids que mudaram e devolve o estado', async () => {
    const identity = { setStudentCanonicalChoice: jest.fn().mockResolvedValue({ affectedActivityLogIds: ['run', 'watch'] }) };
    const link = { reconcileAffectedByIdentity: jest.fn().mockResolvedValue(true) };
    const service = new IdentityConfirmationService({} as never, identity as never, link as never);
    expect(await service.chooseCanonicalAsStudent('u1', 'watch', true)).toEqual({ ok: true, changedActivityLogIds: ['run', 'watch'], choice: 'chosen' });
    expect(link.reconcileAffectedByIdentity).toHaveBeenCalledWith({ affectedActivityLogIds: ['run', 'watch'], activityLogId: undefined } as never, null);
    expect((await service.chooseCanonicalAsStudent('u1', 'watch', false)).choice).toBe('default');
  });
});

describe('ligacoes (estatico)', () => {
  const read = (...parts: string[]) => readFileSync(join(__dirname, '..', ...parts), 'utf8');
  it('rota da aluna, coluna no esquema e migracao coerentes; marca some com a exclusao dos detalhes', () => {
    expect(read('src', 'activity-execution', 'activity-execution.controller.ts')).toContain("@Post(':activityLogId/canonical-choice')");
    expect(read('prisma', 'schema.prisma')).toContain('studentCanonicalChoiceAt DateTime?');
    expect(read('prisma', 'migrations', '20261121120000_student_canonical_choice', 'migration.sql')).toContain('ADD COLUMN "studentCanonicalChoiceAt" TIMESTAMP(3);');
    expect(read('src', 'activity-execution', 'activity-exclusion.ts')).toContain('studentCanonicalChoiceAt: null');
  });
});
