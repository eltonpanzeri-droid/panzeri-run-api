import {
  BadGatewayException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PolarService } from './polar.service';

const ACCESSLINK_BASE = 'https://www.polaraccesslink.com';

export interface PolarSyncResult {
  status: 'synced' | 'no_new_data';
  imported: number;
  resumedTransaction: boolean;
}

// Campos do resumo de exercicio da AccessLink (GET .../exercises/{id}) confirmados por
// documentacao/fontes cruzadas em 01/10/2026. Chaves com hifen -> acesso via indice, nao dot.
// Qualquer campo nao listado aqui (training-load, detailed-sport-info, club-id/name, device,
// percentuais de macronutriente etc.) NAO e descartado: continua preservado inteiro em
// RawExternalActivity.payload, so nao vira coluna canonica (ver justificativa no schema.prisma).
interface PolarExerciseSummary {
  id?: unknown;
  sport?: unknown;
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
  ) {}

  async sync(userId: string): Promise<PolarSyncResult> {
    const connection = await this.prisma.polarConnection.findUnique({ where: { userId } });
    if (!connection) throw new NotFoundException('Conta Polar nao conectada para este usuario.');

    const accessToken = this.polar.decryptAccessToken(connection.accessTokenEncrypted);

    if (!connection.registeredAt) {
      await this.registerUser(userId, accessToken);
    }

    const resumedTransaction = Boolean(connection.openTransactionId);
    const transactionId = connection.openTransactionId
      ?? (await this.openTransaction(userId, connection.polarUserId, accessToken));

    if (!transactionId) {
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
    await this.prisma.polarConnection.update({
      where: { userId },
      data: { openTransactionId: null, openTransactionOpenedAt: null, lastSyncCompletedAt: new Date() },
    });

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
    await this.prisma.polarConnection.update({ where: { userId }, data: { registeredAt: new Date() } });
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
    await this.prisma.polarConnection.update({
      where: { userId },
      data: { openTransactionId: transactionId, openTransactionOpenedAt: new Date() },
    });
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
    const raw = await this.prisma.rawExternalActivity.upsert({
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

    const canonical = this.mapExerciseSummary(summary);
    await this.prisma.activityLog.upsert({
      where: { provider_userId_externalId: { provider: 'polar', userId, externalId } },
      create: { userId, provider: 'polar', externalId, rawActivityId: raw.id, ...canonical },
      update: { rawActivityId: raw.id, ...canonical },
    });
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
      sport: typeof summary.sport === 'string' ? summary.sport : null,
      caloriesKcal: this.asInt(summary.calories),
      avgHeartRateBpm: this.asInt(this.heartRateField(summary, 'average')),
      maxHeartRateBpm: this.asInt(this.heartRateField(summary, 'maximum')),
      hasRoute: typeof summary['has-route'] === 'boolean' ? summary['has-route'] : null,
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
