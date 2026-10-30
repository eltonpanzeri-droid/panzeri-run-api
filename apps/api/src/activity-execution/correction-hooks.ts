import { Logger } from '@nestjs/common';

// Registro de ganchos pos-correcao (15/10/2026). SessionExecutionLinkService (e os fluxos do treinador / exclusao de dados) so' conhecem ESTE arquivo: medalhas
// e Prontuario se registram nele ao iniciar (onModuleInit) — evita dependencia circular entre modulos e mantem um unico ponto central. Um gancho que falha
// NUNCA derruba a correcao (ja gravada) nem os outros ganchos: o erro e' registrado em log.

export type CorrectionKind = 'link_correction' | 'identity_correction' | 'bulk_reconcile' | 'session_edit' | 'provider_data_deleted';
export type CorrectionOrigin = 'student' | 'coach' | 'system';

export interface LinkChange {
  linkId: string;
  trainingSessionId: string;
  activityLogId: string;
  status: string;
  origin: string;
  note: string | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface SessionEditChange {
  sessionId: string;
  // So' os campos que mudaram de fato (antes/depois). 'structure' = estrutura alterada (sem copiar o conteudo).
  fields: Record<string, { before: unknown; after: unknown }>;
  hasFeedback: boolean;
  hasActiveLink: boolean;
}

export interface CorrectionContext {
  userId: string;
  kind: CorrectionKind;
  origin: CorrectionOrigin;
  actorId: string | null;
  at: Date;
  since: Date | null;
  sessionIds: string[];
  activityLogIds: string[];
  // Linhas de feedback (WorkoutCompletion) foram criadas/movidas/apagadas: afeta contagens, constancia, retomada e acumulado.
  completionsChanged: boolean;
  // Vinculos criados/revogados desde `since` (historico de vinculos).
  changes: LinkChange[];
  sessionEdit?: SessionEditChange;
  // Exclusao de dados de provedor: ausencia de dado NAO e' prova de que uma conquista era invalida.
  absenceOfData?: boolean;
  provider?: string;
  // Datas (YYYY-MM-DD) das atividades/sessoes afetadas — escopo de semanas/meses para a reavaliacao de medalhas.
  affectedDates: string[];
}

export type CorrectionHook = (context: CorrectionContext) => Promise<void>;

const logger = new Logger('CorrectionHooks');
const hooks = new Map<string, CorrectionHook>();

export const correctionHooks = {
  /** Registra (ou substitui, pelo nome) um gancho. Idempotente: reiniciar o modulo nao duplica. */
  register(name: string, hook: CorrectionHook): void {
    hooks.set(name, hook);
  },
  unregister(name: string): void {
    hooks.delete(name);
  },
  clear(): void {
    hooks.clear();
  },
  names(): string[] {
    return [...hooks.keys()];
  },
  /** Executa todos os ganchos em sequencia; falha de um nunca interrompe os demais nem propaga. */
  async run(context: CorrectionContext): Promise<void> {
    for (const [name, hook] of hooks) {
      try {
        await hook(context);
      } catch (error) {
        logger.error(`Gancho pos-correcao '${name}' falhou (aluno ${context.userId}, ${context.kind}): ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  },
};

// Atualizacao do relatorio semanal apos mudanca de vinculos (Conciliacao, 30/10/2026). Registro unico (como os ganchos): o ExecutionAnalysisService registra a funcao ao subir;
// quem altera vinculos (correcao do aluno, reconciliacao ao importar atividade) so' pede a atualizacao, sem depender do servico. Falha nunca propaga.
type WeeklyReportRefresher = (userId: string, dates: string[]) => Promise<void>;
let weeklyReportRefresher: WeeklyReportRefresher | null = null;
export const weeklyReportRefresh = {
  set(fn: WeeklyReportRefresher | null): void { weeklyReportRefresher = fn; },
  async run(userId: string, dates: string[]): Promise<void> {
    if (!weeklyReportRefresher || dates.length === 0) return;
    try { await weeklyReportRefresher(userId, dates); } catch (error) { logger.error(`Atualizacao do relatorio semanal falhou (aluno ${userId}): ${error instanceof Error ? error.message : String(error)}`); }
  },
};

// Atividades que chegam em lote (primeira sincronizacao de um historico) mudam varios vinculos da mesma semana: o relatorio e' recalculado UMA vez, apos uma pausa curta,
// em vez de uma vez por atividade. Correcao feita por pessoa chama weeklyReportRefresh.run direto (imediato).
const PENDING_REFRESH_DELAY_MS = 20_000;
const pendingRefresh = new Map<string, Set<string>>();
export function scheduleWeeklyReportRefresh(userId: string, date: string): void {
  const already = pendingRefresh.get(userId);
  if (already) { already.add(date); return; }
  pendingRefresh.set(userId, new Set([date]));
  const timer = setTimeout(() => {
    const dates = [...(pendingRefresh.get(userId) ?? [])];
    pendingRefresh.delete(userId);
    void weeklyReportRefresh.run(userId, dates);
  }, PENDING_REFRESH_DELAY_MS);
  timer.unref?.();
}

const MS_DAY = 86_400_000;

/** Segunda-feira (YYYY-MM-DD) da semana de uma data YYYY-MM-DD. */
export function weekStartOf(iso: string): string {
  const date = new Date(`${iso.slice(0, 10)}T00:00:00.000Z`);
  const dow = (date.getUTCDay() + 6) % 7;
  return new Date(date.getTime() - dow * MS_DAY).toISOString().slice(0, 10);
}

/** Escopo de semanas/meses tocados por um conjunto de datas. */
export function scopeOfDates(dates: string[]): { weeks: string[]; months: string[] } {
  const valid = dates.filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).map((d) => d.slice(0, 10));
  return { weeks: [...new Set(valid.map(weekStartOf))].sort(), months: [...new Set(valid.map((d) => d.slice(0, 7)))].sort() };
}
