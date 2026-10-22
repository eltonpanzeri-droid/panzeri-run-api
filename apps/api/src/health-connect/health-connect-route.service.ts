import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { HealthConnectConsentService } from './health-connect-consent.service';
import { HEALTH_CONNECT_PROVIDER_ID } from './health-connect-consent';
import { normalizeRoutes } from './health-connect-route';

export interface RouteItemResult { recordId: string; status: 'stored' | 'rejected'; reason?: string; points?: number }

// Percurso GPS do Health Connect: liga os pontos a atividade JA importada (mesmo recordId do exercicio). So' grava com `activity_route` (e `activity`) autorizados NO MOMENTO da gravacao,
// dentro de uma transacao com lock de leitura na autorizacao (retirada no meio espera). Refaz o percurso daquela atividade do zero (idempotente). Mesma tabela das series de atividade
// (ActivityTimeSeriesPoint, latitude/longitude); nenhuma outra serie da atividade e' apagada.
@Injectable()
export class HealthConnectRouteService {
  private readonly logger = new Logger(HealthConnectRouteService.name);

  constructor(private readonly prisma: PrismaService, private readonly consent: HealthConnectConsentService) {}

  async importRoutes(userId: string, body: unknown): Promise<{ stored: number; rejected: number; items: RouteItemResult[] }> {
    const normalized = normalizeRoutes(body);
    if (!normalized.ok) throw new BadRequestException(`Percurso invalido: ${normalized.reason}.`);
    const allowed = await this.consent.allowedCategories(userId);
    if (!allowed.has('activity_route') || !allowed.has('activity')) throw new ForbiddenException('Autorizacao do percurso GPS ausente para este aluno.');

    const items: RouteItemResult[] = [];
    for (const route of normalized.routes) {
      try {
        const outcome = await this.consent.writeWhileAuthorized(userId, async (tx, granted) => {
          if (!granted.has('activity_route') || !granted.has('activity')) return 'categoria_nao_autorizada';
          const log = await tx.activityLog.findUnique({ where: { provider_userId_externalId: { provider: HEALTH_CONNECT_PROVIDER_ID, userId, externalId: route.recordId } }, select: { id: true } });
          if (!log) return 'atividade_nao_encontrada';
          await tx.activityTimeSeriesPoint.deleteMany({ where: { activityLogId: log.id, provider: HEALTH_CONNECT_PROVIDER_ID, latitude: { not: null } } });
          await tx.activityTimeSeriesPoint.createMany({
            // A altitude e' sensor (categoria propria): so' e' gravada com `activity_sensors` autorizada.
            data: route.points.map((p) => ({ activityLogId: log.id, provider: HEALTH_CONNECT_PROVIDER_ID, offsetSec: p.offsetSec, normalizationVersion: 1, latitude: p.latitude, longitude: p.longitude, elevationMeters: granted.has('activity_sensors') ? p.elevationMeters : null })),
            skipDuplicates: true,
          });
          await tx.activityLog.update({ where: { id: log.id }, data: { hasRoute: true } });
          return 'stored';
        });
        items.push(outcome === 'stored' ? { recordId: route.recordId, status: 'stored', points: route.points.length } : { recordId: route.recordId, status: 'rejected', reason: outcome ?? 'autorizacao_encerrada' });
      } catch (error) {
        this.logger.warn(`Falha ao gravar percurso Health Connect: ${error instanceof Error ? error.message.slice(0, 160) : 'erro'}`);
        items.push({ recordId: route.recordId, status: 'rejected', reason: 'falha_ao_gravar' });
      }
    }
    return { stored: items.filter((i) => i.status === 'stored').length, rejected: items.filter((i) => i.status === 'rejected').length + normalized.dropped, items };
  }
}
