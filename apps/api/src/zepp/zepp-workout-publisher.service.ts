import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutDeliveryService } from '../workout-delivery/workout-delivery.service';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { canonicalModality } from '../activity-execution/canonical-modality';
import { buildCanonicalWorkout, CanonicalWorkout } from '../training-plans/canonical-workout';
import { ZEPP_PROVIDER_ID } from './zepp.connector';
import { ZEPP_WORKOUT_PROFILE } from './zepp-workout-profile';
import { translateToZeppWorkout, ZEPP_WORKOUT_TRANSLATOR_VERSION, ZeppTranslationRefusal, ZeppV2Workout, ZeppWorkoutProfile } from './zepp-workout-spec';
import { buildZeppWindowBody, zeppWindow, zeppWindowHash } from './zepp-workout-window';
import { ZeppPublishResult, ZeppWorkoutClient } from './zepp-workout-client';

// Publicacao de treinos estruturados na Zepp/Amazfit (Lote 2): TrainingSession -> CanonicalWorkout -> treino V2 -> WorkoutDelivery (provider 'zepp_workout_v2').
// Reaproveita o WorkoutDelivery existente (cada tentativa e' uma linha; 'sent' = a API da Zepp ACEITOU a janela; nunca 'delivered_to_device', pois a API nao confirma o relogio).
// A Zepp CONFIRMOU (21/10/2026) que NAO estende a janela sozinha: a janela completa e' REPUBLICADA todo dia (mesmo sem mudanca) e a cada alteracao. Cada aceite da API e'
// carimbado em providerMetadata (windowAcceptedAt/windowAcceptedDate) — registra que a API aceitou, nunca que o relogio recebeu o treino.
//
// Modelo: RECONCILIACAO. Em vez de eventos espalhados pelo codigo de geracao, `reconcile(userId)` compara, sempre a partir do banco, o que DEVERIA estar no relogio
// (sessoes de corrida prescritas dos proximos 7 dias, traduziveis, ainda nao feitas) com o que a Zepp ACEITOU por ultimo (WorkoutDelivery ativa). Igual => nada a
// enviar. Diferente => reenvia a janela INTEIRA (regra da API). E' idempotente, so' le o estado atual e converge mesmo com duas instancias (apos enviar, recalcula).
//
// Protecoes:
//  - Lista vazia (apagaria tudo na Zepp) so' sai por pedido explicito (`clearWindow`) ou quando o aluno RETIRA a autorizacao com a conexao ainda ativa.
//    Plano arquivado / nenhum treino elegivel NAO apaga o relogio sozinho: o estado vira `clear_required` e o treinador decide.
//  - Desconectou/revogou a conexao: so' cancela as entregas localmente (a Zepp ja remove os treinos pelo endpoint de revogacao; NAO enviamos lista vazia).
//  - Sem consentimento `watch_delivery` (verificado a cada uso) nada e' enviado.
//  - Sem rede dentro de transacao de banco; uma publicacao por aluno por vez (fila em memoria) e releitura apos enviar.
//  - Nada vai para a Zepp enquanto `ZEPP_WORKOUT_PUBLISH_ENABLED` nao for 'true' e enquanto o perfil de unidades (zepp-workout-profile.ts) nao estiver confirmado:
//    passo que depende de resposta pendente da Zepp e' recusado e o treino NAO e' enviado.
export const ZEPP_WORKOUT_PROVIDER = 'zepp_workout_v2';
export const WATCH_DELIVERY_PURPOSE = 'watch_delivery';
export const ZEPP_PUBLISHER_OPTIONS = 'ZEPP_PUBLISHER_OPTIONS';

export interface ZeppPublisherOptions {
  profile?: ZeppWorkoutProfile;
  // Aloca um workoutId inteiro novo (producao: sequence do banco). Injetavel nos testes.
  nextWorkoutId?: () => Promise<number>;
  today?: () => string;
}

export type SkippedReason = { sessionId: string; reason: string; pendingZeppAnswer: boolean };
type DesiredItem = { sessionId: string; scheduledDate: string; specHash: string; workout: ZeppV2Workout; canonical: CanonicalWorkout; canonicalWarningCodes: string[]; existingWorkoutId: number | null };
type ActiveRow = { id: string; trainingSessionId: string; status: string; externalWorkoutId: string | null; providerMetadata: unknown };

export type ReconcileResult =
  | { status: 'disabled' }
  | { status: 'not_connected' }
  | { status: 'unchanged'; workouts: number; skipped: SkippedReason[] }
  | { status: 'published'; workouts: number; skipped: SkippedReason[] }
  // Sem nenhuma mudanca nos treinos: a janela completa foi republicada so' porque a Zepp nao a estende sozinha (rotina diaria).
  | { status: 'republished'; workouts: number; skipped: SkippedReason[] }
  | { status: 'cleared'; reason: string }
  | { status: 'clear_required'; skipped: SkippedReason[] }
  | { status: 'failed'; kind: string; message: string };

const MAX_PASSES = 3;
const SESSION_DISTANCE_TOLERANCE_KM = 0.06;

function todayInSaoPauloIso(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

// Unidades confirmadas (distancia e pace). Os demais campos do perfil (passo sem meta, pace unico, limites) NAO bloqueiam o envio: cada passo que depende de um deles e'
// recusado individualmente, com motivo, e so' esse treino deixa de ser enviado.
export function profileIsConfirmed(profile: ZeppWorkoutProfile): boolean {
  return profile.distanceUnit !== null && profile.paceUnit !== null;
}

// Carimbo do ultimo aceite da janela pela API (data local de Sao Paulo). Presente em TODAS as entregas ativas apos cada publicacao aceita.
function acceptedDateOf(row: { providerMetadata: unknown }): string | null {
  const value = (row.providerMetadata as { windowAcceptedDate?: unknown } | null)?.windowAcceptedDate;
  return typeof value === 'string' ? value : null;
}

@Injectable()
export class ZeppWorkoutPublisherService {
  private readonly logger = new Logger(ZeppWorkoutPublisherService.name);
  private readonly queues = new Map<string, Promise<unknown>>();
  private readonly profile: ZeppWorkoutProfile;
  private readonly allocateId: () => Promise<number>;
  private readonly today: () => string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: WorkoutDeliveryService,
    private readonly connections: ProviderConnectionService,
    private readonly consent: ProviderConsentService,
    private readonly client: ZeppWorkoutClient,
    private readonly config: ConfigService,
    @Optional() @Inject(ZEPP_PUBLISHER_OPTIONS) options?: ZeppPublisherOptions,
  ) {
    this.profile = options?.profile ?? ZEPP_WORKOUT_PROFILE;
    this.today = options?.today ?? todayInSaoPauloIso;
    this.allocateId = options?.nextWorkoutId ?? (async () => {
      // sequence do banco (migration 20261020120000_zepp_workout_id_sequence): inteiro unico e estavel dentro da plataforma, como a Zepp exige
      const rows = await this.prisma.$queryRaw<Array<{ id: bigint | number }>>`SELECT nextval('zepp_workout_id_seq') AS id`;
      return Number(rows[0].id);
    });
  }

  isPublishingEnabled(): boolean {
    return this.config.get<string>('ZEPP_WORKOUT_PUBLISH_ENABLED')?.trim().toLowerCase() === 'true';
  }

  // Uma operacao por aluno por vez (as demais esperam). Estado sempre relido do banco, entao a ultima a rodar vence com o estado atual.
  private serialize<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.queues.set(userId, next);
    void next.finally(() => { if (this.queues.get(userId) === next) this.queues.delete(userId); }).catch(() => undefined);
    return next;
  }

  reconcile(userId: string): Promise<ReconcileResult> {
    return this.serialize(userId, () => this.reconcileNow(userId));
  }

  // Retirar os treinos do relogio por pedido EXPLICITO (unico caminho de lista vazia alem da revogacao da finalidade).
  clearWindow(userId: string, reason = 'pedido_explicito'): Promise<ReconcileResult> {
    return this.serialize(userId, () => this.clearNow(userId, reason));
  }

  async status(userId: string) {
    const today = this.today();
    const desired = await this.computeDesired(userId, today);
    const active = await this.activeRows(userId, today);
    const connected = await this.consent.isAllowed(ZEPP_PROVIDER_ID, userId, 'profile');
    const authorized = connected && (await this.consent.isAllowed(ZEPP_PROVIDER_ID, userId, 'profile', WATCH_DELIVERY_PURPOSE));
    return {
      publishingEnabled: this.isPublishingEnabled(),
      unitProfileConfirmed: profileIsConfirmed(this.profile),
      connected,
      watchDeliveryAuthorized: authorized,
      window: zeppWindow(today),
      eligible: desired.items.length,
      skipped: desired.skipped,
      // "aceito pela Zepp" = a API aceitou a janela; NAO significa que o relogio ja' recebeu (a API nao confirma isso).
      acceptedByZepp: active.length,
      windowAcceptedToday: active.length > 0 && active.every((row) => acceptedDateOf(row) === today),
      inSync: this.sameSet(desired.items, active),
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------

  private async reconcileNow(userId: string): Promise<ReconcileResult> {
    if (!this.isPublishingEnabled()) return { status: 'disabled' };
    const today = this.today();
    const connected = await this.consent.isAllowed(ZEPP_PROVIDER_ID, userId, 'profile');
    if (!connected) {
      // Revogacao/desconexao: a Zepp ja removeu os treinos pelo endpoint de revogacao (nao enviar lista vazia). So' encerra o estado local.
      await this.cancelAllActive(userId);
      return { status: 'not_connected' };
    }
    const authorized = await this.consent.isAllowed(ZEPP_PROVIDER_ID, userId, 'profile', WATCH_DELIVERY_PURPOSE);
    if (!authorized) {
      // O aluno retirou a autorizacao COM a conexao ativa: os treinos ja sincronizados precisam sair da Zepp (texto do consentimento 1.2).
      const active = await this.activeRows(userId, today);
      if (active.length === 0) return { status: 'not_connected' };
      return this.clearNow(userId, 'autorizacao_retirada');
    }

    // A Zepp nao estende a janela sozinha (confirmado em 21/10/2026): mesmo sem nenhuma mudanca, a janela COMPLETA e' republicada uma vez por dia.
    let dailyRepublish = false;
    for (let pass = 0; pass < MAX_PASSES; pass += 1) {
      const desired = await this.computeDesired(userId, today);
      const active = await this.activeRows(userId, today);
      const inSync = this.sameSet(desired.items, active);
      const acceptedToday = active.every((row) => acceptedDateOf(row) === today);
      if (inSync && (desired.items.length === 0 || acceptedToday)) {
        if (pass === 0) return { status: 'unchanged', workouts: desired.items.length, skipped: desired.skipped };
        return { status: dailyRepublish ? 'republished' : 'published', workouts: desired.items.length, skipped: desired.skipped };
      }
      // Lista vazia NUNCA e' enviada aqui (apagaria tudo na Zepp): sem treino elegivel o treinador decide (clear_required).
      if (desired.items.length === 0) return { status: 'clear_required', skipped: desired.skipped };
      if (pass === 0 && inSync) dailyRepublish = true;

      const outcome = await this.publish(userId, today, desired.items, active);
      if (!outcome.ok) return { status: 'failed', kind: outcome.kind, message: outcome.message };
      // Reler: se o estado mudou enquanto enviavamos (outra instancia, edicao do treinador), a proxima passada reenvia a janela com o estado novo.
    }
    return { status: 'published', workouts: (await this.computeDesired(userId, today)).items.length, skipped: [] };
  }

  private async publish(userId: string, today: string, items: DesiredItem[], active: ActiveRow[]): Promise<{ ok: true } | { ok: false; kind: string; message: string }> {
    const activeBySession = new Map(active.map((row) => [row.trainingSessionId, row]));
    const changed = items.filter((item) => !this.matches(item, activeBySession.get(item.sessionId)));

    // 1) workoutId estavel por sessao: reutiliza o ja usado; so' aloca para sessao nova.
    const workouts: ZeppV2Workout[] = [];
    for (const item of items) {
      const id = item.existingWorkoutId ?? (await this.allocateId());
      item.existingWorkoutId = id;
      workouts.push({ ...item.workout, workoutId: id });
    }

    // 2) reserva (pending) das linhas das sessoes novas/alteradas ANTES de falar com a Zepp.
    const windowBody = buildZeppWindowBody(today, workouts);
    const windowHash = zeppWindowHash(windowBody);
    const created: Array<{ id: string; sessionId: string; externalWorkoutId: string }> = [];
    for (const item of changed) {
      const row = await this.deliveries.recordAttempt({
        trainingSessionId: item.sessionId,
        provider: ZEPP_WORKOUT_PROVIDER,
        canonicalWorkout: item.canonical as unknown as Prisma.InputJsonValue,
        externalWorkoutId: String(item.existingWorkoutId),
        providerMetadata: {
          channel: 'zepp_workout_v2', scheduledDate: item.scheduledDate, specHash: item.specHash, translatorVersion: ZEPP_WORKOUT_TRANSLATOR_VERSION, windowHash,
          zeppWorkout: workouts.find((w) => w.workoutId === item.existingWorkoutId) ?? null, canonicalWarningCodes: item.canonicalWarningCodes,
        } as unknown as Prisma.InputJsonValue,
      });
      created.push({ id: row.id, sessionId: item.sessionId, externalWorkoutId: String(item.existingWorkoutId) });
    }

    // 3) envio (fora de qualquer transacao)
    const token = await this.connections.getAccessToken(ZEPP_PROVIDER_ID, userId, 'profile').catch(() => null);
    const result: ZeppPublishResult = token ? await this.client.publish(token, windowBody) : { ok: false, kind: 'auth', httpStatus: null, code: null, message: 'Sem token de acesso valido.' };

    // 4) resultado
    if (!result.ok) {
      for (const row of created) await this.deliveries.markFailed(row.id, `${result.kind}${result.code !== null ? ` (${result.code})` : ''}: ${result.message}`.slice(0, 500)).catch(() => undefined);
      this.logger.warn(`Publicacao Zepp falhou (${result.kind}) para o aluno ${userId}.`);
      return { ok: false, kind: result.kind, message: result.message };
    }
    const stillDesired = new Set(items.map((item) => item.sessionId));
    for (const row of created) await this.deliveries.markSent(row.id, { externalWorkoutId: row.externalWorkoutId });
    const keptIds: string[] = [];
    for (const row of active) {
      const superseded = changed.some((item) => item.sessionId === row.trainingSessionId);
      if (superseded || !stillDesired.has(row.trainingSessionId)) await this.deliveries.markCanceled(row.id).catch(() => undefined);
      else keptIds.push(row.id);
    }
    // Carimbo do aceite da API em TODAS as entregas que seguem valendo (novas e mantidas): e' ele que dispensa a republicacao ate' o proximo dia.
    await this.stampAcceptance([...created.map((row) => row.id), ...keptIds], today, windowHash);
    return { ok: true };
  }

  // Registra que a API da Zepp ACEITOU a janela (data local e instante). Nao diz que o relogio recebeu. Falha aqui nao desfaz o envio: no pior caso a janela e' republicada.
  private async stampAcceptance(ids: string[], today: string, windowHash: string) {
    const acceptedAt = new Date().toISOString();
    for (const id of ids) {
      try {
        const row = await this.prisma.workoutDelivery.findUnique({ where: { id }, select: { providerMetadata: true } });
        const metadata = (row?.providerMetadata && typeof row.providerMetadata === 'object' ? row.providerMetadata : {}) as Record<string, unknown>;
        await this.prisma.workoutDelivery.update({ where: { id }, data: { providerMetadata: { ...metadata, windowAcceptedAt: acceptedAt, windowAcceptedDate: today, windowHash } as unknown as Prisma.InputJsonValue } });
      } catch (error) {
        this.logger.warn(`Nao consegui registrar o aceite da janela Zepp (entrega ${id}): ${(error as Error).message}`);
      }
    }
  }

  private async clearNow(userId: string, reason: string): Promise<ReconcileResult> {
    if (!this.isPublishingEnabled()) return { status: 'disabled' };
    const today = this.today();
    const connected = await this.consent.isAllowed(ZEPP_PROVIDER_ID, userId, 'profile');
    if (!connected) {
      await this.cancelAllActive(userId);
      return { status: 'not_connected' };
    }
    let token: string;
    try { token = await this.connections.getAccessToken(ZEPP_PROVIDER_ID, userId, 'profile'); }
    catch (error) { return { status: 'failed', kind: 'token', message: (error as Error).message }; }
    const body = buildZeppWindowBody(today, [], { allowEmpty: true });
    const result = await this.client.publish(token, body);
    if (!result.ok) return { status: 'failed', kind: result.kind, message: result.message };
    await this.cancelAllActive(userId);
    this.logger.log(`Treinos retirados do relogio (Zepp) do aluno ${userId}: ${reason}.`);
    return { status: 'cleared', reason };
  }

  private async cancelAllActive(userId: string) {
    const rows = await this.prisma.workoutDelivery.findMany({
      where: { provider: ZEPP_WORKOUT_PROVIDER, status: { in: ['pending', 'sent'] }, trainingSession: { userId } },
      select: { id: true },
    });
    for (const row of rows) await this.deliveries.markCanceled(row.id).catch(() => undefined);
  }

  // Entregas ATIVAS (aceitas pela Zepp) do aluno com treino ainda na janela. 'pending' nunca conta como "ja esta no relogio".
  private async activeRows(userId: string, today: string): Promise<ActiveRow[]> {
    const rows = await this.prisma.workoutDelivery.findMany({
      where: { provider: ZEPP_WORKOUT_PROVIDER, status: 'sent', trainingSession: { userId } },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, trainingSessionId: true, status: true, externalWorkoutId: true, providerMetadata: true },
    });
    const latestBySession = new Map<string, ActiveRow>();
    for (const row of rows) if (!latestBySession.has(row.trainingSessionId)) latestBySession.set(row.trainingSessionId, row);
    return [...latestBySession.values()].filter((row) => {
      const date = (row.providerMetadata as { scheduledDate?: string } | null)?.scheduledDate;
      return typeof date === 'string' && date >= today;
    });
  }

  private matches(item: DesiredItem, row: ActiveRow | undefined): boolean {
    if (!row) return false;
    const meta = (row.providerMetadata ?? {}) as { specHash?: string; scheduledDate?: string };
    return meta.specHash === item.specHash && meta.scheduledDate === item.scheduledDate;
  }

  private sameSet(items: DesiredItem[], active: ActiveRow[]): boolean {
    if (items.length !== active.length) return false;
    const bySession = new Map(active.map((row) => [row.trainingSessionId, row]));
    return items.every((item) => this.matches(item, bySession.get(item.sessionId)));
  }

  // O que DEVERIA estar no relogio agora. Traduz so' o que ja foi decidido (estrutura da sessao); recusa o que depende de resposta pendente da Zepp.
  private async computeDesired(userId: string, today: string): Promise<{ items: DesiredItem[]; skipped: SkippedReason[] }> {
    const { startDate, endDate } = zeppWindow(today);
    const sessions = await this.prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { gte: new Date(`${startDate}T00:00:00Z`), lte: new Date(`${endDate}T00:00:00Z`) }, plan: { status: 'active' } },
      orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }],
      include: { completion: { select: { status: true } }, executionLinks: { where: { status: 'active' }, select: { id: true }, take: 1 } },
    });
    const previous = await this.prisma.workoutDelivery.findMany({
      where: { provider: ZEPP_WORKOUT_PROVIDER, trainingSessionId: { in: sessions.map((s) => s.id) }, externalWorkoutId: { not: null } },
      orderBy: { requestedAt: 'desc' },
      select: { trainingSessionId: true, externalWorkoutId: true },
    });
    const idBySession = new Map<string, number>();
    for (const row of previous) {
      const id = Number(row.externalWorkoutId);
      if (Number.isInteger(id) && id > 0 && !idBySession.has(row.trainingSessionId)) idBySession.set(row.trainingSessionId, id);
    }

    const items: DesiredItem[] = [];
    const skipped: SkippedReason[] = [];
    for (const session of sessions) {
      const skip = (reason: string, pendingZeppAnswer = false) => skipped.push({ sessionId: session.id, reason, pendingZeppAnswer });
      const structure = (session.structure && typeof session.structure === 'object' ? session.structure : {}) as { type?: unknown };
      if (session.origin === 'device_extra' || session.origin === 'student_extra' || structure.type === 'extra') { skip('sessao_extra'); continue; }
      if (canonicalModality(session.modality) !== 'corrida') { skip('modalidade_nao_suportada'); continue; }
      if (structure.type !== 'run') { skip('estrutura_nao_suportada'); continue; }
      if (session.completion || session.executionLinks.length > 0) { skip('sessao_ja_realizada'); continue; }

      const canonical = buildCanonicalWorkout({ id: session.id, modality: session.modality, structure: session.structure });
      const existingWorkoutId = idBySession.get(session.id) ?? null;
      const translation = translateToZeppWorkout(canonical, { workoutId: existingWorkoutId ?? 1, distanceKm: session.distanceKm, scheduledDate: session.scheduledDate.toISOString().slice(0, 10) }, this.profile);
      if (!translation.ok) {
        const first: ZeppTranslationRefusal = translation.refusals[0];
        skip(first.code, translation.refusals.every((refusal) => refusal.pendingZeppAnswer));
        continue;
      }
      // A distancia gravada na sessao e a da estrutura precisam concordar (senao nao ha prescricao inequivoca).
      const derivedKm = canonical.derived.totalDistanceMeters / 1000;
      if (session.distanceKm != null && derivedKm > 0 && Math.abs(session.distanceKm - derivedKm) > SESSION_DISTANCE_TOLERANCE_KM) { skip('distancia_inconsistente'); continue; }
      items.push({ sessionId: session.id, scheduledDate: translation.workout.workoutDate, specHash: translation.specHash, workout: translation.workout, canonical, canonicalWarningCodes: translation.canonicalWarningCodes, existingWorkoutId });
    }
    return { items, skipped };
  }
}
