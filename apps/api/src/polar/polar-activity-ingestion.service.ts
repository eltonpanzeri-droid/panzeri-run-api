import {
  BadGatewayException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ActivityTimeSeriesService } from '../activity-timeseries/activity-timeseries.service';
import { SessionExecutionLinkService } from '../activity-execution/session-execution-link.service';
import { ActivityNotificationService } from '../activity-execution/activity-notification.service';
import { PolarService } from './polar.service';
import { extractPolarProviderMetrics, normalizePolarModality, PolarNormalizerInput } from './polar-activity-normalizer';

const ACCESSLINK_BASE = 'https://www.polaraccesslink.com';

// Lancada quando a conexao foi revogada no meio de um sync: nada mais pode ser persistido.
export class CollectionRevokedError extends Error {
  constructor() { super('Coleta Polar revogada pelo usuario.'); }
}

export interface PolarSyncResult {
  status: 'synced' | 'no_new_data' | 'in_progress' | 'disconnected';
  imported: number;
  resumedTransaction: boolean;
}

// Campos do resumo de exercicio da AccessLink (GET .../exercises/{id}) confirmados por
// documentacao/fontes cruzadas em 01/10/2026, incluindo os campos de modalidade/metricas
// proprietarias adicionados na normalizacao Polar -> canonico (ver polar-activity-normalizer.ts).
// Chaves com hifen -> acesso via indice, nao dot. Qualquer campo nao listado aqui (club-id/name
// etc.) NAO e descartado: continua preservado inteiro em RawExternalActivity.payload, so nao vira
// coluna canonica nem providerMetrics (ver justificativa no schema.prisma).
interface PolarExerciseSummary extends PolarNormalizerInput {
  id?: unknown;
  duration?: unknown;
  distance?: unknown;
  calories?: unknown;
  ['start-time']?: unknown;
  ['start-time-utc-offset']?: unknown;
  ['has-route']?: unknown;
  ['heart-rate']?: unknown;
}

// Implementa o adaptador de entrada Polar AccessLink -> RawExternalActivity -> ActivityLog.
// Fluxo real da AccessLink (transaction-based, NAO e polling por data como o Strava):
//   registrar usuario (uma vez) -> abrir transaction -> listar exercicios pendentes -> buscar
//   cada resumo -> persistir raw + canonico -> so entao commitar a transaction.
// So commitamos DEPOIS que todo exercicio listado foi persistido com sucesso — se qualquer um
// falhar, a transaction fica aberta (PolarConnection.openTransactionId) e o proximo sync a
// RETOMA em vez de abrir outra (a Polar so aceita uma transaction aberta por vez; abrir 2a da
// 409). Isso torna repeticao apos falha parcial segura: exercicios ja persistidos fazem upsert
// idempotente (no-op), so os que faltaram sao reprocessados.
@Injectable()
export class PolarActivityIngestionService {
  private readonly logger = new Logger(PolarActivityIngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly polar: PolarService,
    private readonly timeSeries: ActivityTimeSeriesService,
    private readonly sessionExecutionLink: SessionExecutionLinkService,
    private readonly activityNotifications: ActivityNotificationService,
  ) {}

  // Trava por usuario (03/10/2026): webhook, polling e botao manual sao gatilhos do MESMO sync. Dois
  // disparos simultaneos do mesmo aluno nao podem abrir/retomar a mesma transaction Polar ao mesmo
  // tempo — o segundo apenas informa que ja' ha' sincronizacao em andamento.
  private readonly syncsInFlight = new Set<string>();

  async sync(userId: string): Promise<PolarSyncResult> {
    if (this.syncsInFlight.has(userId)) {
      return { status: 'in_progress', imported: 0, resumedTransaction: false };
    }
    this.syncsInFlight.add(userId);
    try {
      return await this.runSync(userId);
    } catch (error) {
      // Revogada no meio do sync: encerra sem erro e sem persistir mais nada.
      if (error instanceof CollectionRevokedError) return { status: 'disconnected', imported: 0, resumedTransaction: false };
      throw error;
    } finally {
      this.syncsInFlight.delete(userId);
    }
  }

  private async runSync(userId: string): Promise<PolarSyncResult> {
    const connection = await this.prisma.polarConnection.findUnique({ where: { userId } });
    if (!connection) throw new NotFoundException('Conta Polar nao conectada para este usuario.');
    // Fonte canonica de consentimento: disconnectedAt. Vale para sync manual, polling, webhook e retry,
    // que passam todos por aqui. Sem token tambem nao ha coleta possivel.
    if (connection.disconnectedAt || !connection.accessTokenEncrypted) {
      throw new ConflictException('Conta Polar desconectada. Conecte novamente para sincronizar.');
    }

    const accessToken = this.polar.decryptAccessToken(connection.accessTokenEncrypted);

    if (!connection.registeredAt) {
      await this.registerUser(userId, accessToken);
    }

    const resumedTransaction = Boolean(connection.openTransactionId);
    const transactionId = connection.openTransactionId
      ?? (await this.openTransaction(userId, connection.polarUserId, accessToken));

    // Tentativa concluida com sucesso sem nada novo (204 da Polar) conta como sincronizada: o
    // lastSyncCompletedAt registra que a conexao foi conferida. Falhas nao chegam aqui (lancam antes).
    if (!transactionId) {
      await this.updateConnectionIfActive(userId, { lastSyncCompletedAt: new Date() });
      return { status: 'no_new_data', imported: 0, resumedTransaction: false };
    }

    const exerciseUrls = await this.listTransactionExercises(connection.polarUserId, transactionId, accessToken);

    let imported = 0;
    const failures: string[] = [];
    for (const url of exerciseUrls) {
      try {
        await this.ingestExercise(userId, url, accessToken, transactionId);
        imported++;
      } catch (error) {
        if (error instanceof CollectionRevokedError) throw error;
        this.logger.error(`Falha ao importar exercicio Polar (${url}): ${error instanceof Error ? error.message : String(error)}`);
        failures.push(url);
      }
    }

    if (failures.length > 0) {
      throw new InternalServerErrorException(
        `Sincronizacao Polar parcial: ${imported}/${exerciseUrls.length} exercicio(s) importado(s). ` +
          'A transacao Polar nao foi confirmada e sera retomada automaticamente na proxima sincronizacao.',
      );
    }

    await this.commitTransaction(connection.polarUserId, transactionId, accessToken);
    await this.updateConnectionIfActive(userId, { openTransactionId: null, openTransactionOpenedAt: null, lastSyncCompletedAt: new Date() });

    return { status: 'synced', imported, resumedTransaction };
  }

  private async registerUser(userId: string, accessToken: string) {
    let response: Response;
    try {
      response = await fetch(`${ACCESSLINK_BASE}/v3/users`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({ 'member-id': userId }),
      });
    } catch {
      throw new BadGatewayException('Nao foi possivel registrar o usuario na Polar AccessLink.');
    }
    if (response.status === 401) throw new UnauthorizedException('Token Polar invalido ou expirado. Reconecte a conta Polar.');
    // 409 = usuario ja registrado para este client Polar em tentativa anterior — idempotente.
    if (!response.ok && response.status !== 409) {
      throw new BadGatewayException(`A Polar recusou o registro do usuario (status ${response.status}).`);
    }
    await this.updateConnectionIfActive(userId, { registeredAt: new Date() });
  }

  // Escrita de estado da conexao que nunca ressuscita uma conexao revogada (race sync x desconexao).
  private async updateConnectionIfActive(userId: string, data: Prisma.PolarConnectionUpdateManyMutationInput) {
    await this.prisma.polarConnection.updateMany({ where: { userId, disconnectedAt: null }, data });
  }

  // Toda persistencia de dado coletado passa por aqui. A linha da conexao fica travada em modo
  // compartilhado ate o commit: a desconexao (UPDATE na mesma linha) espera a escrita terminar, e uma
  // escrita que comecar depois da desconexao nao encontra conexao ativa e aborta. Rede fica fora.
  private async writeIfStillAuthorized<T>(userId: string, write: (tx: Prisma.TransactionClient) => Promise<T>): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const active = await tx.$queryRaw<Array<{ id: string }>>`SELECT "id" FROM "PolarConnection" WHERE "userId" = ${userId} AND "disconnectedAt" IS NULL FOR SHARE`;
      if (active.length === 0) throw new CollectionRevokedError();
      return write(tx);
    });
  }

  private async openTransaction(userId: string, polarUserId: string, accessToken: string): Promise<string | null> {
    let response: Response;
    try {
      response = await fetch(`${ACCESSLINK_BASE}/v3/users/${polarUserId}/exercise-transactions`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
    } catch {
      throw new BadGatewayException('Nao foi possivel abrir a sincronizacao com a Polar.');
    }
    if (response.status === 401) throw new UnauthorizedException('Token Polar invalido ou expirado. Reconecte a conta Polar.');
    if (response.status === 204) return null; // nada novo desde a ultima transacao commitada
    if (response.status !== 201) {
      throw new BadGatewayException(`A Polar recusou abrir a sincronizacao (status ${response.status}).`);
    }
    let body: { ['transaction-id']?: unknown; id?: unknown } = {};
    try { body = await response.json(); } catch { /* algumas respostas so trazem Location */ }
    const transactionId = this.extractTransactionId(body, response.headers.get('location'));
    if (!transactionId) throw new BadGatewayException('Resposta da Polar sem identificador de transacao.');

    // Gravado ANTES de processar qualquer exercicio: se o processo cair logo em seguida, o
    // proximo sync reutiliza esta mesma transaction (nunca abre uma segunda).
    await this.updateConnectionIfActive(userId, { openTransactionId: transactionId, openTransactionOpenedAt: new Date() });
    return transactionId;
  }

  private extractTransactionId(body: { ['transaction-id']?: unknown; id?: unknown }, location: string | null): string | null {
    if (typeof body['transaction-id'] === 'string' || typeof body['transaction-id'] === 'number') return String(body['transaction-id']);
    if (typeof body.id === 'string' || typeof body.id === 'number') return String(body.id);
    if (location) {
      const match = location.match(/exercise-transactions\/([^/?]+)/);
      if (match) return match[1];
    }
    return null;
  }

  private async listTransactionExercises(polarUserId: string, transactionId: string, accessToken: string): Promise<string[]> {
    let response: Response;
    try {
      response = await fetch(`${ACCESSLINK_BASE}/v3/users/${polarUserId}/exercise-transactions/${transactionId}`, {
        headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      });
    } catch {
      throw new BadGatewayException('Nao foi possivel listar os exercicios pendentes na Polar.');
    }
    if (response.status === 401) throw new UnauthorizedException('Token Polar invalido ou expirado. Reconecte a conta Polar.');
    if (!response.ok) throw new BadGatewayException(`A Polar recusou listar exercicios (status ${response.status}).`);
    let body: { exercises?: unknown } = {};
    try { body = await response.json(); } catch { throw new BadGatewayException('Resposta invalida da Polar ao listar exercicios.'); }
    if (!Array.isArray(body.exercises)) return [];
    return body.exercises.filter((item): item is string => typeof item === 'string');
  }

  private async ingestExercise(userId: string, exerciseUrl: string, accessToken: string, transactionId: string) {
    let response: Response;
    try {
      response = await fetch(exerciseUrl, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
    } catch {
      throw new BadGatewayException('Nao foi possivel buscar um exercicio na Polar.');
    }
    if (response.status === 401) throw new UnauthorizedException('Token Polar invalido ou expirado. Reconecte a conta Polar.');
    if (!response.ok) throw new BadGatewayException(`A Polar recusou o exercicio (status ${response.status}).`);
    let summary: PolarExerciseSummary;
    try { summary = await response.json(); } catch { throw new BadGatewayException('Resposta de exercicio Polar invalida.'); }

    const externalId = this.asId(summary.id);
    if (!externalId) throw new BadGatewayException('Exercicio Polar sem id valido.');

    // Raw primeiro, sempre — mesmo que o mapeamento canonico abaixo falhe depois, o payload
    // bruto ja fica preservado e disponivel para reprocessamento futuro.
    const canonical = this.mapExerciseSummary(summary);
    const { raw, activityLog } = await this.writeIfStillAuthorized(userId, async (tx) => {
    const raw = await tx.rawExternalActivity.upsert({
      where: { provider_userId_externalId: { provider: 'polar', userId, externalId } },
      create: {
        userId,
        provider: 'polar',
        externalId,
        payload: summary as object,
        payloadSchemaVersion: 'polar-accesslink-v3-exercise-summary',
        ingestionMeta: { transactionId, endpoint: exerciseUrl, fetchedAt: new Date().toISOString() },
      },
      update: {
        payload: summary as object,
        ingestionMeta: { transactionId, endpoint: exerciseUrl, fetchedAt: new Date().toISOString() },
      },
    });

    const activityLog = await tx.activityLog.upsert({
      where: { provider_userId_externalId: { provider: 'polar', userId, externalId } },
      create: { userId, provider: 'polar', externalId, rawActivityId: raw.id, ...canonical },
      update: { rawActivityId: raw.id, ...canonical },
    });
    return { raw, activityLog };
    });

    // Samples (02/10/2026) — SEMPRE depois do resumo ja persistido com sucesso. Qualquer falha
    // aqui dentro e' so' logada, nunca propagada: a ActivityLog/RawExternalActivity do resumo ja
    // esta' salva e correta, e uma falha de samples nao pode fazer sync() tratar este exercicio
    // inteiro como falho (o que reabriria a transaction Polar sem necessidade).
    await this.ingestSamples(userId, activityLog.id, exerciseUrl, accessToken);

    // Normalizacao canonica (03/10/2026) — le os RawActivitySample recem-persistidos e preenche
    // ActivityTimeSeriesPoint. Mesma garantia de resiliencia que ingestSamples: nunca propaga falha
    // pro sync() (o resumo ja esta salvo e correto independente desta etapa ter funcionado).
    try {
      await this.timeSeries.normalizeFromRawSamples(activityLog.id, 'polar');
    } catch (error) {
      this.logger.warn(`Falha ao normalizar serie temporal da atividade ${activityLog.id}: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Aciona o Motor de Reconciliacao ja' existente (03/10/2026) — antes desta linha, classify()
    // nunca era chamado por nenhum adapter de provedor (ver cabecalho de
    // session-execution-link.service.ts), entao uma ActivityLog Polar ficava para sempre sem
    // executionClassification/SessionExecutionLink ate' alguem chamar classify() manualmente. So'
    // uma chamada ao metodo ja' existente — nenhuma logica de correspondencia nova foi criada aqui.
    // Idempotente (classify() nao reclassifica se ja' houver classificacao) e resiliente (falha
    // nunca derruba o resumo/raw/serie ja' persistidos).
    let classification: string | null = null;
    try {
      classification = await this.sessionExecutionLink.classify(activityLog.id);
    } catch (error) {
      this.logger.warn(`Falha ao classificar atividade ${activityLog.id} no Motor de Reconciliacao: ${error instanceof Error ? error.message : String(error)}`);
    }

    // Notificacao pos-sincronizacao (03/10/2026): idempotente por activityLog+classificacao, entao
    // resync/retry/webhook/manual nao repetem o aviso. Falha de notificacao nunca derruba a ingestao.
    try {
      await this.activityNotifications.notifyReconciliation(userId, activityLog.id, classification);
    } catch (error) {
      this.logger.warn(`Falha ao notificar sincronizacao da atividade ${activityLog.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // Busca os tipos de samples REALMENTE disponiveis pra esta atividade especifica (nunca assume
  // uma lista fixa) e preserva cada um como uma linha RawActivitySample. Ver comentario do model
  // em schema.prisma: isto e' camada RAW, nao canonica — nenhuma interpretacao do conteudo
  // acontece aqui, so' preservacao do que a Polar devolveu.
  private async ingestSamples(userId: string, activityLogId: string, exerciseUrl: string, accessToken: string) {
    // Rede 'try' em volta do METODO INTEIRO (nao so' do fetch) de proposito: requisito explicito e'
    // que NENHUMA falha de samples — rede, parsing, OU um erro de escrita no banco dentro do loop —
    // possa derrubar a ActivityLog/RawExternalActivity do resumo, que ja foi salva com sucesso
    // antes desta chamada (ver ingestExercise). So' loga e segue.
    try {
      let listResponse: Response;
      try {
        listResponse = await fetch(`${exerciseUrl}/samples`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
      } catch (error) {
        this.logger.warn(`Falha de rede ao listar samples disponiveis (${exerciseUrl}/samples): ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      // 404/204 = provider nao tem samples pra esta atividade especifica (dispositivo sem sensor,
      // atividade manual, etc.) — ausencia de dado, nunca tratada como erro de sincronizacao.
      if (listResponse.status === 404 || listResponse.status === 204) return;
      if (listResponse.status === 401) {
        this.logger.warn('Token Polar invalido/expirado ao listar samples — ignorado nesta etapa (resumo ja foi salvo).');
        return;
      }
      if (!listResponse.ok) {
        this.logger.warn(`Provider recusou listar samples (${exerciseUrl}/samples): status ${listResponse.status}.`);
        return;
      }

      let listBody: unknown;
      try {
        listBody = await listResponse.json();
      } catch (error) {
        this.logger.warn(`Resposta de listagem de samples ilegivel (${exerciseUrl}/samples): ${error instanceof Error ? error.message : String(error)}`);
        return;
      }

      const entries = this.extractSampleEntries(listBody);
      for (const entry of entries) {
        // Por entrada: falha ao persistir UM tipo (ex.: erro de banco pontual) nunca deve impedir
        // os demais tipos daquela mesma atividade de serem tentados.
        try {
          await this.ingestOneSample(userId, activityLogId, exerciseUrl, entry, accessToken);
        } catch (error) {
          if (error instanceof CollectionRevokedError) throw error;
          this.logger.warn(`Falha ao persistir sample "${entry.sampleType}" da atividade ${activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
    } catch (error) {
      if (error instanceof CollectionRevokedError) throw error;
      this.logger.warn(`Falha inesperada ao sincronizar samples da atividade ${activityLogId}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  // A estrutura real da resposta de "available samples" NAO esta confirmada por teste real ainda
  // (ver pedido original — "nao use type-id fixo de exemplo da internet como contrato"). Esta
  // funcao e' deliberadamente DEFENSIVA: aceita tanto uma lista bruta quanto um objeto com a lista
  // dentro de uma chave comum, aceita entradas como string (URL) ou objeto (com tipo + url e/ou
  // dado ja' embutido). Tipo desconhecido/formato inesperado NUNCA lanca — vira uma entrada com
  // sampleType 'unknown' (ou o melhor palpite disponivel) e e' preservado do mesmo jeito.
  private extractSampleEntries(body: unknown): Array<{ sampleType: string; url?: string; inlinePayload?: unknown }> {
    const list: unknown[] = Array.isArray(body)
      ? body
      : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>).samples)
      ? (body as Record<string, unknown>).samples as unknown[]
      : body && typeof body === 'object' && Array.isArray((body as Record<string, unknown>)['available-samples'])
      ? (body as Record<string, unknown>)['available-samples'] as unknown[]
      : [];

    const entries: Array<{ sampleType: string; url?: string; inlinePayload?: unknown }> = [];
    for (const item of list) {
      if (typeof item === 'string') {
        // Entrada e' so' uma URL — ultimo segmento do path e' o melhor palpite de tipo disponivel
        // ate' buscarmos o conteudo; preservado como veio, nunca inventa um nome "bonito".
        const guessedType = item.split('/').filter(Boolean).pop() || 'unknown';
        entries.push({ sampleType: guessedType, url: item });
        continue;
      }
      if (item && typeof item === 'object') {
        const obj = item as Record<string, unknown>;
        const typeCandidate = obj['sample-type'] ?? obj['type'] ?? obj['sampleType'];
        const sampleType = typeof typeCandidate === 'string' ? typeCandidate
          : typeof typeCandidate === 'number' ? String(typeCandidate)
          : 'unknown';
        const url = typeof obj['href'] === 'string' ? obj['href'] : typeof obj['url'] === 'string' ? obj['url'] : undefined;
        // Se a propria listagem ja' trouxer a serie embutida (algum campo array alem de
        // metadados conhecidos), preserva direto sem round-trip extra.
        const hasInlineSeries = Object.keys(obj).some((key) => Array.isArray(obj[key]));
        entries.push({ sampleType, url, inlinePayload: hasInlineSeries ? obj : undefined });
        continue;
      }
      // Entrada em formato totalmente inesperado (numero solto, null, etc.) — preservada mesmo
      // assim, nunca descartada silenciosamente nem usada pra quebrar o loop inteiro.
      entries.push({ sampleType: 'unknown', inlinePayload: item });
    }
    return entries;
  }

  private async ingestOneSample(
    userId: string,
    activityLogId: string,
    exerciseUrl: string,
    entry: { sampleType: string; url?: string; inlinePayload?: unknown },
    accessToken: string,
  ) {
    let payload = entry.inlinePayload;
    const endpoint = entry.url ?? null;

    if (payload === undefined) {
      if (!entry.url) {
        this.logger.warn(`Sample "${entry.sampleType}" sem URL nem dado embutido na listagem (${exerciseUrl}/samples) — ignorado.`);
        return;
      }
      let response: Response;
      try {
        response = await fetch(entry.url, { headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' } });
      } catch (error) {
        this.logger.warn(`Falha de rede ao buscar sample "${entry.sampleType}" (${entry.url}): ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (!response.ok) {
        this.logger.warn(`Provider recusou sample "${entry.sampleType}" (${entry.url}): status ${response.status}.`);
        return;
      }
      try {
        payload = await response.json();
      } catch (error) {
        this.logger.warn(`Resposta de sample "${entry.sampleType}" ilegivel (${entry.url}): ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    await this.writeIfStillAuthorized(userId, (tx) => tx.rawActivitySample.upsert({
      where: { activityLogId_provider_sampleType: { activityLogId, provider: 'polar', sampleType: entry.sampleType } },
      create: {
        activityLogId,
        provider: 'polar',
        sampleType: entry.sampleType,
        payload: payload as Prisma.InputJsonValue,
        providerMeta: { endpoint, fetchedVia: entry.inlinePayload !== undefined ? 'available-samples-inline' : 'per-type-fetch' },
      },
      update: {
        payload: payload as Prisma.InputJsonValue,
        providerMeta: { endpoint, fetchedVia: entry.inlinePayload !== undefined ? 'available-samples-inline' : 'per-type-fetch' },
      },
    }));
  }

  private async commitTransaction(polarUserId: string, transactionId: string, accessToken: string) {
    let response: Response;
    try {
      response = await fetch(`${ACCESSLINK_BASE}/v3/users/${polarUserId}/exercise-transactions/${transactionId}`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${accessToken}` },
      });
    } catch {
      throw new BadGatewayException('Nao foi possivel confirmar a sincronizacao com a Polar.');
    }
    if (response.status === 401) throw new UnauthorizedException('Token Polar invalido ou expirado. Reconecte a conta Polar.');
    if (!response.ok) throw new BadGatewayException(`A Polar recusou confirmar a sincronizacao (status ${response.status}).`);
  }

  // So mapeia o que ja da pra justificar como canonico com confianca real (ver comentario em
  // ActivityLog no schema.prisma). Campo ausente ou de formato inesperado vira null — nunca 0,
  // nunca inventado. Nao lanca por causa de um campo secundario faltando; so start-time (base de
  // tudo) e tratado como erro explicito para este exercicio especifico.
  private mapExerciseSummary(summary: PolarExerciseSummary) {
    return {
      startedAt: this.parseStartedAt(summary),
      utcOffsetMinutes: this.asInt(summary['start-time-utc-offset']),
      durationSec: this.parseIsoDurationSeconds(summary.duration),
      distanceMeters: this.asFloat(summary.distance),
      // Modalidade CANONICA do Panzeri Run (nunca o enum bruto da Polar) — ver
      // polar-activity-normalizer.ts. sport=OTHER + detailed-sport-info=STRENGTH_TRAINING
      // confirmado em producao como treino de forca; sport sozinho nao e suficiente.
      sport: normalizePolarModality(summary),
      caloriesKcal: this.asInt(summary.calories),
      avgHeartRateBpm: this.asInt(this.heartRateField(summary, 'average')),
      maxHeartRateBpm: this.asInt(this.heartRateField(summary, 'maximum')),
      hasRoute: typeof summary['has-route'] === 'boolean' ? summary['has-route'] : null,
      // Metricas proprietarias da Polar, estruturadas mas identificaveis pela coluna "provider"
      // desta mesma linha — nunca viram variavel canonica (ver schema.prisma e normalizer).
      providerMetrics: (extractPolarProviderMetrics(summary) ?? Prisma.JsonNull) as Prisma.InputJsonValue,
    };
  }

  private heartRateField(summary: PolarExerciseSummary, field: 'average' | 'maximum'): unknown {
    const heartRate = summary['heart-rate'];
    if (!heartRate || typeof heartRate !== 'object') return undefined;
    return (heartRate as Record<string, unknown>)[field];
  }

  // start-time da AccessLink e documentado como hora LOCAL do dispositivo (sem timezone
  // embutido) na maioria dos exemplos encontrados — por isso so aceitamos um valor com timezone
  // explicito (Z ou +HH:MM) direto, e para o formato sem timezone exigimos tambem
  // start-time-utc-offset para converter para UTC de forma explicita. Nunca assumimos o fuso do
  // servidor (esse foi o bug latente encontrado no StravaService.sameDay(), que compara datas em
  // UTC sem considerar o fuso real da aluna — aqui preferimos falhar este exercicio especifico a
  // repetir o mesmo erro).
  private parseStartedAt(summary: PolarExerciseSummary): Date {
    const raw = summary['start-time'];
    if (typeof raw !== 'string') throw new BadGatewayException('Exercicio Polar sem start-time.');

    if (/[Zz]$|[+-]\d{2}:?\d{2}$/.test(raw)) {
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) throw new BadGatewayException('Exercicio Polar com start-time ilegivel.');
      return parsed;
    }

    const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?$/);
    const offsetMinutes = this.asInt(summary['start-time-utc-offset']);
    if (!match || offsetMinutes === null) {
      throw new BadGatewayException('Exercicio Polar sem start-time/offset suficiente para converter para UTC com seguranca.');
    }
    const [, y, mo, d, h, mi, s] = match;
    const localAsUtcMs = Date.UTC(Number(y), Number(mo) - 1, Number(d), Number(h), Number(mi), Number(s));
    return new Date(localAsUtcMs - offsetMinutes * 60_000);
  }

  private parseIsoDurationSeconds(value: unknown): number | null {
    if (typeof value !== 'string') return null;
    const match = value.match(/^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?$/);
    if (!match) return null;
    const hours = Number(match[1] ?? 0);
    const minutes = Number(match[2] ?? 0);
    const seconds = Number(match[3] ?? 0);
    return Math.round(hours * 3600 + minutes * 60 + seconds);
  }

  private asId(value: unknown): string | null {
    if (typeof value === 'string' && value) return value;
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
    return null;
  }

  private asInt(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return Math.round(value);
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Math.round(Number(value));
    return null;
  }

  private asFloat(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);
    return null;
  }
}
