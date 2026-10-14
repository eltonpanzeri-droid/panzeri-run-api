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
