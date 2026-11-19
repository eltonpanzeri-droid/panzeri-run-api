import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ACCOUNT_DELETE_ORDER, ACCOUNT_PRESERVED } from './account-deletion.service';

// Exportacao dos dados da propria aluna (19/11/2026, ordem de Elton: "arrume a exportacao de dados, para todas as integracoes"). Direito de acesso e portabilidade (LGPD) + exigencia de parceiros como a Garmin.
// Fonte unica de "o que e' dado da aluna": a MESMA lista usada na exclusao de conta (ACCOUNT_DELETE_ORDER + ACCOUNT_PRESERVED). Modelo novo com userId classificado la' entra aqui sozinho; ha teste que trava a divergencia.
// Cobre todas as integracoes porque lista as conexoes e tudo que cada uma trouxe (Strava, Polar, Wahoo, Garmin/COROS/Zepp/Samsung pela Central, Health Connect, Wear OS).
// NUNCA exporta segredos: tokens, senhas, hashes e chaves sao removidos por nome de campo; tentativas de login/OAuth e travas internas ficam de fora.

// Fora da exportacao: segredo/uso interno, nao e' dado da aluna.
export const DATA_EXPORT_EXCLUDED = new Set<string>([
  'passwordResetToken', 'passwordResetCode', 'loginLinkToken', 'stravaOAuthAttempt', 'polarOAuthAttempt', 'wahooOAuthAttempt', 'providerOAuthAttempt',
  'trainingPlanGenerationLock', 'freeTesterEmail', 'aiGenerationCost',
]);

// Campos cujo NOME indica segredo (removidos em qualquer nivel).
const SECRET_KEY = /token|secret|password|passwordhash|hash|apikey|api_key|accesskey|credential|authorization|cookie/i;
const MAX_ROWS_PER_MODEL = 20_000;
const MAX_STRING = 100_000; // string maior que isso (ex.: foto em base64) e' omitida com aviso

export function redactForExport(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item) => {
    if (key && SECRET_KEY.test(key)) return undefined;
    if (typeof item === 'bigint') return item.toString();
    if (item && typeof item === 'object' && (item as { type?: unknown }).type === 'Buffer' && Array.isArray((item as { data?: unknown }).data)) return `[arquivo binario omitido: ${(item as { data: unknown[] }).data.length} bytes]`;
    if (typeof item === 'string' && item.length > MAX_STRING) return `[texto muito grande omitido: ${item.length} caracteres]`;
    return item;
  }));
}

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(private readonly prisma: PrismaService) {}

  async build(userId: string) {
    const db = this.prisma as unknown as Record<string, { findMany: (args: unknown) => Promise<unknown[]>; findUnique?: (args: unknown) => Promise<unknown> }>;
    const user = await (this.prisma as unknown as { user: { findUnique: (args: unknown) => Promise<Record<string, unknown> | null> } }).user.findUnique({ where: { id: userId } });
    if (!user || user.accountStatus === 'deleted') throw new NotFoundException('Conta nao encontrada.');

    const sessionIds = (await db.trainingSession.findMany({ where: { userId }, select: { id: true } })).map((row) => (row as { id: string }).id);
    const logIds = (await db.activityLog.findMany({ where: { userId }, select: { id: true } })).map((row) => (row as { id: string }).id);

    const data: Record<string, unknown[]> = {};
    const summary: Record<string, { registros: number; incompleto: boolean }> = {};
    for (const model of [...ACCOUNT_DELETE_ORDER, ...ACCOUNT_PRESERVED.filter((name) => name !== 'user')]) {
      if (DATA_EXPORT_EXCLUDED.has(model)) continue;
      let where: Record<string, unknown>;
      switch (model) {
        case 'workoutDelivery': where = { trainingSessionId: { in: sessionIds } }; break;
        case 'rawActivitySample':
        case 'activityTimeSeriesPoint':
        case 'activityHrDecoupling': where = { activityLogId: { in: logIds } }; break;
        case 'problemReportImage': where = { report: { userId } }; break;
        default: where = { userId };
      }
      try {
        const rows = await db[model].findMany({ where, take: MAX_ROWS_PER_MODEL + 1 });
        const incompleto = rows.length > MAX_ROWS_PER_MODEL;
        const kept = incompleto ? rows.slice(0, MAX_ROWS_PER_MODEL) : rows;
        if (kept.length === 0) continue;
        data[model] = kept;
        summary[model] = { registros: kept.length, incompleto };
      } catch (error) {
        // Um modelo com problema nao pode esconder o resto dos dados da aluna: registra e segue.
        this.logger.warn(`Exportacao: falha ao ler ${model}: ${error instanceof Error ? error.message.slice(0, 120) : 'erro'}`);
        summary[model] = { registros: 0, incompleto: true };
      }
    }

    return redactForExport({
      geradoEm: new Date().toISOString(),
      sobre: 'Seus dados no Panzeri Run, em formato JSON. Segredos de acesso (senhas, tokens de integracao) nao sao exportados. Se algum bloco aparecer como incompleto, fale com o suporte para receber o restante.',
      conta: user,
      resumo: summary,
      dados: data,
    });
  }
}
