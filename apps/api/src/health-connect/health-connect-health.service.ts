import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { HealthConnectConsentService } from './health-connect-consent.service';
import { HEALTH_CONNECT_PROVIDER_ID } from './health-connect-consent';
import { HEALTH_RECORD_CATEGORY, MAX_HEALTH_RECORDS_PER_BATCH, normalizeHealthRecord, NormalizedHealthRecord } from './health-connect-health-records';

export interface HealthRecordItemResult { recordId: string | null; status: 'stored' | 'rejected'; reason?: string }
export interface HealthConnectHealthResult { stored: number; rejected: number; items: HealthRecordItemResult[] }

// Recebimento de SAUDE do Health Connect (sono, saude diaria, HRV, VO2 max, composicao corporal e demais indicadores). O userId vem SEMPRE do JWT. Cada registro so' e' guardado se a categoria
// correspondente esta autorizada NO MOMENTO DA GRAVACAO (fail-closed): cada registro e' gravado numa transacao propria, com lock de leitura na autorizacao e as categorias RELIDAS ali dentro —
// uma retirada feita no meio do lote espera, e o que foi retirado nao e' gravado. Uma falha num registro nao afeta os demais. Mesmas tabelas da Zepp (Wearable*), provider 'health_connect'.
// Idempotente: o mesmo registro reenviado atualiza a mesma linha. Nunca notifica o aluno.
@Injectable()
export class HealthConnectHealthService {
  private readonly logger = new Logger(HealthConnectHealthService.name);

  constructor(private readonly consent: HealthConnectConsentService) {}

  async importRecords(userId: string, body: unknown): Promise<HealthConnectHealthResult> {
    const records = (body as { records?: unknown } | null)?.records;
    if (!Array.isArray(records) || records.length === 0) throw new BadRequestException('Informe records (lista nao vazia).');
    if (records.length > MAX_HEALTH_RECORDS_PER_BATCH) throw new BadRequestException(`No maximo ${MAX_HEALTH_RECORDS_PER_BATCH} registros por envio.`);
    // Sem nenhuma autorizacao ativa a chamada inteira e' recusada (o app nem deveria enviar).
    if ((await this.consent.allowedCategories(userId)).size === 0) throw new ForbiddenException('Nenhuma autorizacao de dados ativa para este aluno.');

    const items: HealthRecordItemResult[] = [];
    for (const input of records) {
      const normalized = normalizeHealthRecord(input);
      if (!normalized.ok) { items.push({ recordId: normalized.recordId, status: 'rejected', reason: normalized.reason }); continue; }
      const value = normalized.value;
      const kind = value.type === 'metric' ? value.metricKind : value.type;
      const recordId = value.identity;
      try {
        const outcome = await this.consent.writeWhileAuthorized(userId, async (tx, allowed) => {
          // O registro diario carrega duas categorias independentes (atividade do dia e FC de repouso): basta uma, e so' os campos da autorizada sao guardados.
          const permitted = kind === 'daily' ? allowed.has('daily_activity') || allowed.has('resting_heart_rate') : allowed.has(HEALTH_RECORD_CATEGORY[kind]);
          if (!permitted) return 'categoria_nao_autorizada';
          await this.persist(tx, userId, value, { daily: allowed.has('daily_activity'), resting: allowed.has('resting_heart_rate') });
          return 'stored';
        });
        if (outcome === 'stored') items.push({ recordId, status: 'stored' });
        else items.push({ recordId, status: 'rejected', reason: outcome ?? 'autorizacao_encerrada' });
      } catch (error) {
        this.logger.warn(`Falha ao gravar registro de saude Health Connect (${kind}): ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
        items.push({ recordId, status: 'rejected', reason: 'falha_ao_gravar' });
      }
    }
    return { stored: items.filter((i) => i.status === 'stored').length, rejected: items.filter((i) => i.status === 'rejected').length, items };
  }

  private async persist(tx: Prisma.TransactionClient, userId: string, record: NormalizedHealthRecord, allowed: { daily: boolean; resting: boolean }): Promise<void> {
    const provider = HEALTH_CONNECT_PROVIDER_ID;
    const summaryId = (identity: string, dataOrigin: string | null) => `${dataOrigin ?? 'origem_desconhecida'}|${identity}`.slice(0, 200);
    if (record.type === 'metric') {
      const data = { calendarDate: record.calendarDate, startOffsetSec: record.startOffsetSec, providerSummaryId: summaryId(record.identity, record.origin.dataOrigin), values: record.values as never };
      await tx.wearableMetricRecord.upsert({
        where: { userId_provider_metricKind_identityKey: { userId, provider, metricKind: record.metricKind, identityKey: record.identity } },
        create: { userId, provider, metricKind: record.metricKind, identityKey: record.identity, startTimeSec: record.startTimeSec, ...data },
        update: { startTimeSec: record.startTimeSec, ...data },
      });
      return;
    }
    const key = { userId_provider_calendarDate_startTimeSec: { userId, provider, calendarDate: record.calendarDate, startTimeSec: record.startTimeSec } };
    const base = { startOffsetSec: record.startOffsetSec, providerSummaryId: summaryId(record.identity, record.origin.dataOrigin) };
    if (record.type === 'sleep') {
      const d = record.data;
      const data = { ...base, durationSec: d.durationSec, deepSleepSec: d.deepSleepSec, lightSleepSec: d.lightSleepSec, remSleepSec: d.remSleepSec, awakeSec: d.awakeSec, unmeasurableSec: d.unmeasurableSec, endTimeSec: d.endTimeSec, levels: d.levels as never };
      await tx.wearableSleepSummary.upsert({ where: key, create: { userId, provider, calendarDate: record.calendarDate, startTimeSec: record.startTimeSec, ...data }, update: data });
    } else if (record.type === 'hrv') {
      const data = { ...base, lastNightAvg: record.data.lastNightAvg, hrvValues: record.data.hrvValues as never };
      await tx.wearableHrvSummary.upsert({ where: key, create: { userId, provider, calendarDate: record.calendarDate, startTimeSec: record.startTimeSec, ...data }, update: data });
    } else {
      const d = record.data;
      const data = { ...base, steps: allowed.daily ? d.steps : null, distanceMeters: allowed.daily ? d.distanceMeters : null, activeKilocalories: allowed.daily ? d.activeKilocalories : null, restingHeartRateBpm: allowed.resting ? d.restingHeartRateBpm : null };
      await tx.wearableDailySummary.upsert({ where: key, create: { userId, provider, calendarDate: record.calendarDate, startTimeSec: record.startTimeSec, ...data }, update: data });
    }
  }
}
