import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { WorkoutDeliveryService } from '../workout-delivery/workout-delivery.service';
import { ProviderConnectionService } from '../provider-hub/provider-connection.service';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { isRunModality } from '../activity-execution/canonical-modality';
import { buildCanonicalWorkout, CanonicalWorkout } from '../training-plans/canonical-workout';
import { GARMIN_PROVIDER_ID } from './garmin.connector';
import { GarminTrainingClient, GarminTrainingError } from './garmin-training-client';
import { GARMIN_WORKOUT_TRANSLATOR_VERSION, GarminWorkout, translateToGarminWorkout } from './garmin-workout-spec';

// Publicacao de treinos estruturados na Garmin (08/11/2026): TrainingSession -> CanonicalWorkout -> workout Garmin -> WorkoutDelivery (provider 'garmin_training'). Diferente da COROS, a Training API da
// Garmin permite CRIAR, ATUALIZAR e APAGAR treino e agendamento — entao o Panzeri Run mantem o calendario da Garmin igual ao programa dos proximos 7 dias:
//  - treino novo => cria o treino e o agendamento; mesmo dia com estrutura alterada => atualiza o MESMO treino; mudou de dia => atualiza o agendamento; sem mudanca => nada e' enviado;
//  - treino que saiu do programa, autorizacao retirada => APAGA agendamento e treino (se nao conseguir apagar, fica como "retirada pendente": nunca se diz que apagou sem ter apagado);
//    conta desconectada => nao ha mais token: o que ja' estava no Garmin Connect fica la (retirada pendente) e a aluna pode apagar la;
//  - 'sent' = a Garmin ACEITOU o treino; nunca 'delivered_to_device' (a API nao confirma o relogio; a aluna sincroniza o relogio no Garmin Connect);
//  - se a aluna apagou o treino no Garmin Connect (404 ao atualizar), ele e' recriado; sem rede dentro de transacao; uma operacao por aluna por vez; releitura do banco a cada passada.
// Limites do Starter: 100 chamadas/min por app e 200/dia por aluna (criar = 2 chamadas). 429 interrompe a rodada e a rotina de 30 min tenta de novo. Ligado por padrao; desligue com
// GARMIN_WORKOUT_PUBLISH_ENABLED=false. So' corrida estruturada; forca e fortalecimento nao sao enviados.
export const GARMIN_WORKOUT_PROVIDER = 'garmin_training';
export const GARMIN_WATCH_DELIVERY_PURPOSE = 'watch_delivery';
export const GARMIN_WINDOW_DAYS = 7;
const SESSION_DISTANCE_TOLERANCE_KM = 0.06;

export type GarminSkipped = { sessionId: string; reason: string };
type DesiredItem = { sessionId: string; scheduledDate: string; specHash: string; workout: GarminWorkout; canonical: CanonicalWorkout; canonicalWarningCodes: string[] };
type ActiveRow = { id: string; trainingSessionId: string; externalWorkoutId: string | null; providerMetadata: unknown };
type Meta = { scheduledDate?: string; specHash?: string; scheduleId?: string | null; ownerId?: string | null; removalPending?: boolean; removalReason?: string };

export type GarminReconcileResult =
  | { status: 'disabled' | 'not_connected' | 'not_authorized' }
  | { status: 'unchanged'; workouts: number; skipped: GarminSkipped[] }
  | { status: 'published'; created: number; updated: number; removed: number; workouts: number; skipped: GarminSkipped[]; removalPending: number }
  | { status: 'failed'; kind: string; message: string; created: number; updated: number };

const todayInSaoPauloIso = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
const addDaysIso = (iso: string, days: number) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };
const metaOf = (row: { providerMetadata: unknown } | undefined): Meta => ((row?.providerMetadata && typeof row.providerMetadata === 'object' ? row.providerMetadata : {}) as Meta);

@Injectable()
export class GarminWorkoutPublisherService {
  private readonly logger = new Logger(GarminWorkoutPublisherService.name);
  private readonly queues = new Map<string, Promise<unknown>>();
  today: () => string = todayInSaoPauloIso;

  constructor(
    private readonly prisma: PrismaService,
    private readonly deliveries: WorkoutDeliveryService,
    private readonly connections: ProviderConnectionService,
    private readonly consent: ProviderConsentService,
    private readonly client: GarminTrainingClient,
    private readonly config: ConfigService,
  ) {}

  isPublishingEnabled(): boolean {
    return this.config.get<string>('GARMIN_WORKOUT_PUBLISH_ENABLED')?.trim().toLowerCase() !== 'false';
  }

  private serialize<T>(userId: string, work: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(userId) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(work);
    this.queues.set(userId, next);
    void next.finally(() => { if (this.queues.get(userId) === next) this.queues.delete(userId); }).catch(() => undefined);
    return next;
  }

  reconcile(userId: string): Promise<GarminReconcileResult> {
    return this.serialize(userId, () => this.reconcileNow(userId));
  }

  async status(userId: string) {
    const today = this.today();
    const desired = await this.computeDesired(userId, today);
    const active = await this.activeRows(userId, today);
    const connected = await this.consent.isAllowed(GARMIN_PROVIDER_ID, userId, 'profile');
    const authorized = connected && (await this.consent.isAllowed(GARMIN_PROVIDER_ID, userId, 'profile', GARMIN_WATCH_DELIVERY_PURPOSE));
    const stamps = active.map((row) => (row.providerMetadata as { sentToGarminAt?: unknown } | null)?.sentToGarminAt).filter((v): v is string => typeof v === 'string').sort();
    const bySession = new Map(active.map((row) => [row.trainingSessionId, row]));
    return {
      publishingEnabled: this.isPublishingEnabled(),
      connected,
      watchDeliveryAuthorized: authorized,
      window: { startDate: today, endDate: addDaysIso(today, GARMIN_WINDOW_DAYS - 1) },
      eligible: desired.items.length,
      skipped: desired.skipped,
      // "aceito pela Garmin" = a API aceitou o treino; NAO significa que o relogio ja' recebeu (a aluna sincroniza o relogio no Garmin Connect).
      acceptedByGarmin: active.length,
      lastAcceptedAt: stamps.length > 0 ? stamps[stamps.length - 1] : null,
      inSync: desired.items.length === active.length && desired.items.every((item) => this.matches(item, bySession.get(item.sessionId))),
      removalPending: (await this.removalPendingRows(userId, today)).length,
    };
  }

  // ---------------------------------------------------------------------------------------------------------------------------------------------------------

  private async reconcileNow(userId: string): Promise<GarminReconcileResult> {
    if (!this.isPublishingEnabled()) return { status: 'disabled' };
    const today = this.today();
    const connected = await this.consent.isAllowed(GARMIN_PROVIDER_ID, userId, 'profile');
    if (!connected) { await this.retireAll(userId, null, 'conta_desconectada'); return { status: 'not_connected' }; }
    const authorized = await this.consent.isAllowed(GARMIN_PROVIDER_ID, userId, 'profile', GARMIN_WATCH_DELIVERY_PURPOSE);
    if (!authorized) {
      // autorizacao retirada com a conta ainda conectada: ainda ha' token, entao APAGA o que foi enviado
      let t: string | null = null;
      try { t = await this.connections.getAccessToken(GARMIN_PROVIDER_ID, userId, 'profile'); } catch { t = null; }
      await this.retireAll(userId, t, 'autorizacao_retirada');
      return { status: 'not_authorized' };
    }

    const desired = await this.computeDesired(userId, today);
    const active = await this.activeRows(userId, today);
    const activeBySession = new Map(active.map((row) => [row.trainingSessionId, row]));
    const toSend = desired.items.filter((item) => !this.matches(item, activeBySession.get(item.sessionId)));
    const stillDesired = new Set(desired.items.map((item) => item.sessionId));
    const doneSessions = new Set(desired.skipped.filter((s) => s.reason === 'sessao_ja_realizada').map((s) => s.sessionId));
    const stale = active.filter((row) => !stillDesired.has(row.trainingSessionId) && !doneSessions.has(row.trainingSessionId));
    if (toSend.length === 0 && stale.length === 0) return { status: 'unchanged', workouts: desired.items.length, skipped: desired.skipped };

    let token: string;
    try { token = await this.connections.getAccessToken(GARMIN_PROVIDER_ID, userId, 'profile'); }
    catch (error) { return { status: 'failed', kind: 'token', message: (error as Error).message, created: 0, updated: 0 }; }

    let created = 0;
    let updated = 0;
    let removed = 0;
    // 1) apaga o que saiu do programa (se nao conseguir, fica "retirada pendente")
    for (const row of stale) {
      try { await this.deleteRemote(token, row); await this.deliveries.markCanceled(row.id).catch(() => undefined); removed += 1; }
      catch (error) {
        if (error instanceof GarminTrainingError && error.kind === 'rate_limit') return { status: 'failed', kind: 'rate_limit', message: error.message, created, updated };
        await this.markRemovalPending(row.id, 'treino_saiu_do_programa');
      }
    }
    // 2) cria / atualiza
    for (const item of toSend) {
      const previous = activeBySession.get(item.sessionId);
      const row = await this.deliveries.recordAttempt({
        trainingSessionId: item.sessionId,
        provider: GARMIN_WORKOUT_PROVIDER,
        canonicalWorkout: item.canonical as unknown as Prisma.InputJsonValue,
        externalWorkoutId: previous?.externalWorkoutId ?? undefined,
        providerMetadata: { channel: 'garmin_training', scheduledDate: item.scheduledDate, specHash: item.specHash, translatorVersion: GARMIN_WORKOUT_TRANSLATOR_VERSION, workout: item.workout, canonicalWarningCodes: item.canonicalWarningCodes } as unknown as Prisma.InputJsonValue,
      });
      try {
        const result = await this.sendOne(token, item, previous);
        await this.deliveries.markSent(row.id, { externalWorkoutId: result.workoutId });
        await this.stamp(row.id, { sentToGarminAt: new Date().toISOString(), scheduleId: result.scheduleId, ownerId: result.ownerId, ...(result.scheduleId ? {} : { scheduleIdMissing: true }) });
        if (previous) await this.deliveries.markCanceled(previous.id).catch(() => undefined);
        if (result.operation === 'update') updated += 1; else created += 1;
      } catch (error) {
        const kind = error instanceof GarminTrainingError ? error.kind : 'erro';
        const message = (error instanceof Error ? error.message : 'falha').slice(0, 300);
        await this.deliveries.markFailed(row.id, `${kind}: ${message}`).catch(() => undefined);
        this.logger.warn(`Envio de treino a Garmin falhou (${kind}) para uma aluna.`);
        // autenticacao, permissao, limite e rede interrompem a rodada; recusa de UM treino (pedido invalido) nao impede os demais
        if (!(error instanceof GarminTrainingError) || error.kind !== 'bad_request') return { status: 'failed', kind, message, created, updated };
      }
    }
    return { status: 'published', created, updated, removed, workouts: desired.items.length, skipped: desired.skipped, removalPending: (await this.removalPendingRows(userId, today)).length };
  }

  private async sendOne(token: string, item: DesiredItem, previous: ActiveRow | undefined): Promise<{ operation: 'create' | 'update'; workoutId: string; scheduleId: string | null; ownerId: string | null }> {
    const prev = metaOf(previous);
    const workoutId = previous?.externalWorkoutId ?? null;
    if (previous && workoutId) {
      try {
        if (prev.specHash !== item.specHash) await this.client.updateWorkout(token, workoutId, prev.ownerId ?? null, item.workout);
        let scheduleId = prev.scheduleId ?? null;
        if (prev.scheduledDate !== item.scheduledDate || !scheduleId) {
          if (scheduleId) await this.client.updateSchedule(token, scheduleId, workoutId, item.scheduledDate);
          else scheduleId = (await this.client.createSchedule(token, workoutId, item.scheduledDate)).scheduleId;
        }
        return { operation: 'update', workoutId, scheduleId, ownerId: prev.ownerId ?? null };
      } catch (error) {
        // a aluna apagou o treino no Garmin Connect: recria (qualquer outro erro sobe)
        if (!(error instanceof GarminTrainingError) || error.kind !== 'not_found') throw error;
      }
    }
    const createdWorkout = await this.client.createWorkout(token, item.workout);
    const { scheduleId } = await this.client.createSchedule(token, createdWorkout.workoutId, item.scheduledDate);
    return { operation: 'create', workoutId: createdWorkout.workoutId, scheduleId, ownerId: createdWorkout.ownerId };
  }

  // Apaga agendamento e treino na Garmin. 404 = ja' nao existe (conta como apagado). Outro erro sobe.
  private async deleteRemote(token: string, row: ActiveRow): Promise<void> {
    const meta = metaOf(row);
    const tolerate = async (action: () => Promise<void>) => { try { await action(); } catch (error) { if (!(error instanceof GarminTrainingError) || error.kind !== 'not_found') throw error; } };
    if (meta.scheduleId) await tolerate(() => this.client.deleteSchedule(token, meta.scheduleId as string));
    if (row.externalWorkoutId) await tolerate(() => this.client.deleteWorkout(token, row.externalWorkoutId as string));
  }

  private async retireAll(userId: string, token: string | null, reason: string) {
    const rows = await this.prisma.workoutDelivery.findMany({ where: { provider: GARMIN_WORKOUT_PROVIDER, status: { in: ['pending', 'sent'] }, trainingSession: { userId } }, select: { id: true, status: true, externalWorkoutId: true, trainingSessionId: true, providerMetadata: true } });
    for (const row of rows) {
      if (row.status !== 'sent' || !row.externalWorkoutId) { await this.deliveries.markCanceled(row.id).catch(() => undefined); continue; }
      if (token) {
        try { await this.deleteRemote(token, row); await this.deliveries.markCanceled(row.id).catch(() => undefined); continue; } catch { /* cai na retirada pendente */ }
      }
      await this.markRemovalPending(row.id, reason);
    }
  }

  private async stamp(deliveryId: string, extra: Record<string, unknown>) {
    try {
      const row = await this.prisma.workoutDelivery.findUnique({ where: { id: deliveryId }, select: { providerMetadata: true } });
      const metadata = (row?.providerMetadata && typeof row.providerMetadata === 'object' ? row.providerMetadata : {}) as Record<string, unknown>;
      await this.prisma.workoutDelivery.update({ where: { id: deliveryId }, data: { providerMetadata: { ...metadata, ...extra } as unknown as Prisma.InputJsonValue } });
    } catch (error) {
      this.logger.warn(`Nao consegui registrar o carimbo do treino Garmin (entrega ${deliveryId}): ${(error as Error).message}`);
    }
  }

  // "Retirada pendente": a entrega deixa de contar como ativa, mas o registro guarda que o treino AINDA pode estar no Garmin Connect.
  private async markRemovalPending(deliveryId: string, reason: string) {
    await this.stamp(deliveryId, { removalPending: true, removalReason: reason, removalPendingAt: new Date().toISOString() });
    await this.deliveries.markCanceled(deliveryId).catch(() => undefined);
  }

  private async activeRows(userId: string, today: string): Promise<ActiveRow[]> {
    const rows = await this.prisma.workoutDelivery.findMany({
      where: { provider: GARMIN_WORKOUT_PROVIDER, status: 'sent', trainingSession: { userId } },
      orderBy: { requestedAt: 'desc' },
      select: { id: true, trainingSessionId: true, externalWorkoutId: true, providerMetadata: true },
    });
    const latestBySession = new Map<string, ActiveRow>();
    for (const row of rows) if (!latestBySession.has(row.trainingSessionId)) latestBySession.set(row.trainingSessionId, row);
    return [...latestBySession.values()].filter((row) => { const date = metaOf(row).scheduledDate; return typeof date === 'string' && date >= today; });
  }

  private async removalPendingRows(userId: string, today: string) {
    const rows = await this.prisma.workoutDelivery.findMany({ where: { provider: GARMIN_WORKOUT_PROVIDER, status: 'canceled', trainingSession: { userId } }, select: { id: true, providerMetadata: true } });
    return rows.map((row) => metaOf(row)).filter((meta) => meta.removalPending === true && typeof meta.scheduledDate === 'string' && meta.scheduledDate >= today);
  }

  private matches(item: DesiredItem, row: ActiveRow | undefined): boolean {
    if (!row) return false;
    const meta = metaOf(row);
    return meta.specHash === item.specHash && meta.scheduledDate === item.scheduledDate;
  }

  // O que DEVERIA estar no calendario nos proximos 7 dias. Traduz so' o que ja' foi decidido (estrutura da sessao); recusa o que nao tem representacao fiel.
  private async computeDesired(userId: string, today: string): Promise<{ items: DesiredItem[]; skipped: GarminSkipped[] }> {
    const endDate = addDaysIso(today, GARMIN_WINDOW_DAYS - 1);
    const sessions = await this.prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { gte: new Date(`${today}T00:00:00Z`), lte: new Date(`${endDate}T00:00:00Z`) }, plan: { status: 'active' } },
      orderBy: [{ scheduledDate: 'asc' }, { id: 'asc' }],
      include: { completion: { select: { status: true } }, executionLinks: { where: { status: 'active' }, select: { id: true }, take: 1 } },
    });
    const items: DesiredItem[] = [];
    const skipped: GarminSkipped[] = [];
    for (const session of sessions) {
      const skip = (reason: string) => skipped.push({ sessionId: session.id, reason });
      const structure = (session.structure && typeof session.structure === 'object' ? session.structure : {}) as { type?: unknown };
      if (session.origin === 'device_extra' || session.origin === 'student_extra' || structure.type === 'extra') { skip('sessao_extra'); continue; }
      if (!isRunModality(session.modality)) { skip('modalidade_nao_suportada'); continue; }
      if (structure.type !== 'run') { skip('estrutura_nao_suportada'); continue; }
      if (session.completion || session.executionLinks.length > 0) { skip('sessao_ja_realizada'); continue; }
      const canonical = buildCanonicalWorkout({ id: session.id, modality: session.modality, structure: session.structure });
      const scheduledDate = session.scheduledDate.toISOString().slice(0, 10);
      const translation = translateToGarminWorkout(canonical, { distanceKm: session.distanceKm, scheduledDate });
      if (!translation.ok) { skip(translation.refusals[0].code); continue; }
      // A distancia gravada na sessao e a da estrutura precisam concordar (senao nao ha prescricao inequivoca).
      const derivedKm = canonical.derived.totalDistanceMeters / 1000;
      if (session.distanceKm != null && derivedKm > 0 && Math.abs(session.distanceKm - derivedKm) > SESSION_DISTANCE_TOLERANCE_KM) { skip('distancia_inconsistente'); continue; }
      items.push({ sessionId: session.id, scheduledDate, specHash: translation.specHash, workout: translation.workout, canonical, canonicalWarningCodes: translation.canonicalWarningCodes });
    }
    return { items, skipped };
  }
}
