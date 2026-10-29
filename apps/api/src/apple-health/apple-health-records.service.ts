import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { MAX_HEALTH_RECORDS_PER_BATCH, normalizeHealthRecord } from '../health-connect/health-connect-health-records';
import { persistHealthRecord } from '../health-connect/health-record-persist';
import { AppleHealthConsentService } from './apple-health-consent.service';
import { APPLE_HEALTH_PROVIDER_ID } from './apple-health-consent';
import { APPLE_HEALTH_RECORD_CATEGORIES, APPLE_RECORD_CATEGORY } from './apple-health-records';

export interface AppleRecordItemResult { recordId: string | null; status: 'stored' | 'rejected'; reason?: string }
export interface AppleHealthRecordsResult { stored: number; rejected: number; items: AppleRecordItemResult[] }

// Recebimento da SAUDE DO DIA A DIA do Apple Saude. O userId vem SEMPRE do JWT. Diferente dos treinos (que aceitam o aplicativo antigo sem registro), estes dados so' sao aceitos com
// consentimento REGISTRADO e vigente para a categoria do registro, relido dentro da transacao que grava (revogacao no meio do lote espera e o que foi retirado nao e' gravado). Cada registro
// e' gravado numa transacao propria: falha de um nao afeta os demais. Idempotente: o mesmo registro reenviado atualiza a mesma linha. Nunca notifica o aluno.
@Injectable()
export class AppleHealthRecordsService {
  private readonly logger = new Logger(AppleHealthRecordsService.name);

  constructor(private readonly consent: AppleHealthConsentService) {}

  async importRecords(userId: string, body: unknown): Promise<AppleHealthRecordsResult> {
    const records = (body as { records?: unknown } | null)?.records;
    if (!Array.isArray(records) || records.length === 0) throw new BadRequestException('Informe records (lista nao vazia).');
    if (records.length > MAX_HEALTH_RECORDS_PER_BATCH) throw new BadRequestException(`No maximo ${MAX_HEALTH_RECORDS_PER_BATCH} registros por envio.`);
    const access = await this.consent.access(userId);
    if (access.mode !== 'recorded' || !APPLE_HEALTH_RECORD_CATEGORIES.some((category) => access.allowed.has(category))) {
      throw new ForbiddenException('Nenhuma autorizacao de dados de saude ativa para este aluno.');
    }

    const items: AppleRecordItemResult[] = [];
    for (const input of records) {
      const normalized = normalizeHealthRecord(input, APPLE_RECORD_CATEGORY);
      if (!normalized.ok) { items.push({ recordId: normalized.recordId, status: 'rejected', reason: normalized.reason }); continue; }
      const value = normalized.value;
      const kind = value.type === 'metric' ? value.metricKind : value.type;
      const recordId = value.identity;
      try {
        const outcome = await this.consent.writeWhileAuthorized(userId, async (tx, current) => {
          if (current.mode !== 'recorded') return 'autorizacao_retirada';
          const daily = current.allowed.has('daily_activity');
          const resting = current.allowed.has('resting_heart_rate');
          const permitted = kind === 'daily' ? daily || resting : current.allowed.has(APPLE_RECORD_CATEGORY[kind]);
          if (!permitted) return 'categoria_nao_autorizada';
          await persistHealthRecord(tx, userId, APPLE_HEALTH_PROVIDER_ID, value, { daily, resting });
          return 'stored';
        });
        if (outcome === 'stored') items.push({ recordId, status: 'stored' });
        else items.push({ recordId, status: 'rejected', reason: outcome });
      } catch (error) {
        this.logger.warn(`Falha ao gravar registro de saude Apple (${kind}): ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
        items.push({ recordId, status: 'rejected', reason: 'falha_ao_gravar' });
      }
    }
    return { stored: items.filter((i) => i.status === 'stored').length, rejected: items.filter((i) => i.status === 'rejected').length, items };
  }
}
