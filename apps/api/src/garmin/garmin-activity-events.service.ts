import { Injectable } from '@nestjs/common';
import { EventOutcome, EventProcessingCapability, InboundEventView } from '../provider-hub/provider-connector';
import { ProviderConsentService } from '../provider-hub/provider-consent.service';
import { GARMIN_PROVIDER_ID } from './garmin.connector';
import { GARMIN_ACTIVITY_EVENT_TYPES, GarminActivityRecord } from './garmin-activity';
import { GarminActivityIngestionService } from './garmin-activity-ingestion.service';
import { GARMIN_HEALTH_EVENT_TYPES } from './garmin-health';
import { GarminHealthEventService } from './garmin-health-events.service';

// Processador dos eventos de atividade da Garmin na fila duravel (08/11/2026). A fila ja' garante idempotencia, trava, espera crescente e o descarte de aluna sem conexao/categoria ANTES de
// chegar aqui. Este servico revalida a conexao e grava no pipeline. Desfechos: 'discard' = nunca vira dado; 'retry' = falha transitoria (excecao tem o mesmo efeito).
const FUTURE_TOLERANCE_MS = 36 * 3_600_000;

@Injectable()
export class GarminActivityEventService implements EventProcessingCapability {
  constructor(
    private readonly consent: ProviderConsentService,
    private readonly ingestion: GarminActivityIngestionService,
    private readonly health?: GarminHealthEventService,
  ) {}

  async handle(event: InboundEventView): Promise<EventOutcome> {
    // Sono, dia, HRV e metricas (push, sem download): processador proprio.
    if ((GARMIN_HEALTH_EVENT_TYPES as readonly string[]).includes(event.eventType)) return this.health ? this.health.handle(event) : { status: 'discard', reason: 'processador de saude indisponivel' };
    if (!(GARMIN_ACTIVITY_EVENT_TYPES as readonly string[]).includes(event.eventType)) return { status: 'discard', reason: 'tipo de evento desconhecido' };
    const userId = event.userId;
    if (!userId) return { status: 'discard', reason: 'conta desconhecida' };
    const record = event.payload as Partial<GarminActivityRecord> | null;
    if (!record || typeof record.summaryId !== 'string' || typeof record.startedAtSec !== 'number' || typeof record.durationSec !== 'number') return { status: 'discard', reason: 'evento de atividade invalido' };

    const snapshot = await this.consent.snapshot(GARMIN_PROVIDER_ID, userId);
    if (!snapshot) return { status: 'discard', reason: 'conexao encerrada' };
    if (!snapshot.categories.includes('activity')) return { status: 'discard', reason: 'categoria nao autorizada pela aluna' };
    // Nao existe historico no Starter: so' o que chega depois da conexao. Mesmo assim, respeita o inicio do periodo autorizado.
    const startMs = record.startedAtSec * 1000;
    if (snapshot.collectFrom && startMs < snapshot.collectFrom.getTime()) return { status: 'discard', reason: 'anterior ao periodo autorizado' };
    if (startMs > Date.now() + FUTURE_TOLERANCE_MS) return { status: 'discard', reason: 'data de inicio no futuro' };

    const result = await this.ingestion.ingest(userId, record as GarminActivityRecord);
    if (!result.written) return { status: 'discard', reason: result.reason === 'excluded' ? 'atividade excluida pela aluna ou treinador' : 'conexao encerrada ou categoria retirada durante o processamento' };
    return { status: 'done' };
  }
}
