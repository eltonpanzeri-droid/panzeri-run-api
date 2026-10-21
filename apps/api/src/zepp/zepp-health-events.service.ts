import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { EventOutcome, InboundEventView } from '../provider-hub/provider-connector';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { ZEPP_PROVIDER_ID } from './zepp.connector';

// Processador dos eventos de SAUDE e RECUPERACAO da Zepp na fila duravel (21/10/2026): sono (sleep_summary), diario (daily_summary) e HRV (hrv_summary). Diferente da atividade, o
// dado chega pronto no corpo do webhook (push), sem download. A fila ja' garante idempotencia, espera crescente, limite de tentativas e o descarte de evento de aluno sem conexao
// ou sem a categoria autorizada ANTES de chegar aqui. Este servico faz o resto:
//  - revalida o consentimento (categoria por categoria) e o periodo autorizado (nada anterior ao momento da conexao e nada no futuro);
//  - grava SOMENTE o que a Zepp mediu e entregou: campo ausente fica nulo (nunca zero, nunca estimado) e a FC de repouso so' vem do evento DIARIO — o evento de sono nao a fornece;
//  - grava dentro da trava de consentimento (retirada no meio do processamento vale) e de forma idempotente: aluno + provedor + dia local + inicio e' a identidade, e uma versao
//    atualizada do mesmo resumo regrava os mesmos valores.
const FUTURE_TOLERANCE_MS = 36 * 3_600_000;
export const ZEPP_HEALTH_EVENT_TYPES = ['sleep_summary', 'daily_summary', 'hrv_summary'] as const;
const CALENDAR_DATE = /^\d{4}-\d{2}-\d{2}$/;

type Json = Prisma.InputJsonValue;
const num = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const int = (value: unknown): number | null => { const n = num(value); return n === null ? null : Math.round(n); };
const text = (value: unknown, max = 100): string | null => (typeof value === 'string' && value.length > 0 && value.length <= max ? value : null);
const json = (value: unknown): Json | undefined => (value === null || value === undefined ? undefined : (value as Json));

@Injectable()
export class ZeppHealthEventService {
  private readonly logger = new Logger(ZeppHealthEventService.name);

  constructor(private readonly consent: ProviderConsentService) {}

  async handle(event: InboundEventView): Promise<EventOutcome> {
    const userId = event.userId;
    if (!userId) return { status: 'discard', reason: 'conta desconhecida' };
    const payload = (event.payload && typeof event.payload === 'object' ? event.payload : {}) as Record<string, unknown>;
    const calendarDate = typeof payload.calendarDate === 'string' && CALENDAR_DATE.test(payload.calendarDate) ? payload.calendarDate : null;
    const startTimeSec = int(payload.startTimeSec);
    const startOffsetSec = int(payload.startOffsetSec);
    if (!calendarDate || startTimeSec === null || startOffsetSec === null) return { status: 'discard', reason: 'evento de saude invalido' };

    const snapshot = await this.consent.snapshot(ZEPP_PROVIDER_ID, userId);
    if (!snapshot) return { status: 'discard', reason: 'conexao encerrada' };
    const required = event.eventType === 'sleep_summary' ? 'sleep' : event.eventType === 'hrv_summary' ? 'hrv' : event.eventType === 'daily_summary' ? 'daily_activity' : null;
    if (!required) return { status: 'discard', reason: 'tipo de evento de saude desconhecido' };
    if (!snapshot.categories.includes(required)) return { status: 'discard', reason: 'categoria nao autorizada pelo aluno' };
    if (snapshot.collectFrom && startTimeSec * 1000 < snapshot.collectFrom.getTime()) return { status: 'discard', reason: 'anterior ao periodo autorizado' };
    if (startTimeSec * 1000 > Date.now() + FUTURE_TOLERANCE_MS) return { status: 'discard', reason: 'data de inicio no futuro' };

    const identity = { calendarDate, startTimeSec, startOffsetSec, providerSummaryId: text(payload.summaryId) };
    const written = await this.consent.writeWhileAuthorized(ZEPP_PROVIDER_ID, userId, async (tx, granted) => {
      // Reconferido DENTRO da trava: o que o aluno retirou no meio do processamento nao e' gravado.
      if (!granted.categories.includes(required)) return null;
      const key = { userId_provider_calendarDate_startTimeSec: { userId, provider: ZEPP_PROVIDER_ID, calendarDate, startTimeSec } };
      if (event.eventType === 'sleep_summary') {
        const data = {
          startOffsetSec, providerSummaryId: identity.providerSummaryId,
          durationSec: int(payload.durationSec), deepSleepSec: int(payload.deepSleepSec), lightSleepSec: int(payload.lightSleepSec), remSleepSec: int(payload.remSleepSec),
          awakeSec: int(payload.awakeSec), napTotalSec: int(payload.napTotalSec), unmeasurableSec: int(payload.unmeasurableSec),
          scoreValue: int(payload.scoreValue), scoreQualifier: text(payload.scoreQualifier, 40), validation: text(payload.validation, 40), endTimeSec: int(payload.endTimeSec),
          levels: json(payload.levels), naps: json(payload.naps),
        };
        await tx.wearableSleepSummary.upsert({ where: key, create: { userId, provider: ZEPP_PROVIDER_ID, calendarDate, startTimeSec, ...data }, update: data });
      } else if (event.eventType === 'hrv_summary') {
        const lastNightAvg = num(payload.lastNightAvg);
        if (lastNightAvg === null) return null;
        const data = { startOffsetSec, providerSummaryId: identity.providerSummaryId, durationSec: int(payload.durationSec), lastNightAvg, hrvValues: json(payload.hrvValues) };
        await tx.wearableHrvSummary.upsert({ where: key, create: { userId, provider: ZEPP_PROVIDER_ID, calendarDate, startTimeSec, ...data }, update: data });
      } else {
        const restingAllowed = granted.categories.includes('resting_heart_rate');
        const data = {
          startOffsetSec, providerSummaryId: identity.providerSummaryId,
          durationSec: int(payload.durationSec), steps: int(payload.steps), distanceMeters: num(payload.distanceMeters), activeKilocalories: num(payload.activeKilocalories),
          // A FC de repouso e' categoria PROPRIA: sem ela, o campo nao e' guardado (fica nulo).
          restingHeartRateBpm: restingAllowed ? int(payload.restingHeartRateBpm) : null,
          stepsGoal: int(payload.stepsGoal),
        };
        await tx.wearableDailySummary.upsert({ where: key, create: { userId, provider: ZEPP_PROVIDER_ID, calendarDate, startTimeSec, ...data }, update: data });
      }
      return true;
    });
    if (!written) return { status: 'discard', reason: 'conexao encerrada ou categoria retirada durante o processamento' };
    return { status: 'done' };
  }
}
