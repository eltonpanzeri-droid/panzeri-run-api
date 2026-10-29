import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { HealthConnectConsentService } from './health-connect-consent.service';
import { HEALTH_CONNECT_PROVIDER_ID } from './health-connect-consent';
import { HEALTH_RECORD_CATEGORY, MAX_HEALTH_RECORDS_PER_BATCH, normalizeHealthRecord } from './health-connect-health-records';
import { persistHealthRecord } from './health-record-persist';

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
          await persistHealthRecord(tx, userId, HEALTH_CONNECT_PROVIDER_ID, value, { daily: allowed.has('daily_activity'), resting: allowed.has('resting_heart_rate') });
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
}
