import { Prisma } from '@prisma/client';
import { activityLocalDate } from '../common/local-date';

// Excluir / ignorar atividade do relogio (01/11/2026, pedido de Elton: aluna E treinador podem; as duas opcoes retiram os dados daquela atividade de TODA analise).
//   'ignored' = fica guardada, reversivel;  'deleted' = detalhes apagados, so' a marca minima permanece (para o relogio nao trazer de volta).
// Este arquivo so' tem regras puras (constantes, texto, retalho de dados da marca minima). A gravacao fica em SessionExecutionLinkService.excludeActivity/restoreActivity.

export const EXCLUSION_MODES = ['ignored', 'deleted'] as const;
export type ExclusionMode = (typeof EXCLUSION_MODES)[number];

export const EXCLUSION_REASONS = ['same_workout_registered', 'not_mine_or_error', 'dont_count', 'other'] as const;
export type ExclusionReason = (typeof EXCLUSION_REASONS)[number];

export const EXCLUSION_REASON_LABEL: Record<ExclusionReason, string> = {
  same_workout_registered: 'é o mesmo treino que já está registrado',
  not_mine_or_error: 'não é minha atividade ou o relógio errou',
  dont_count: 'não quero que conte',
  other: 'outro motivo',
};

export function isExclusionMode(value: unknown): value is ExclusionMode {
  return typeof value === 'string' && (EXCLUSION_MODES as readonly string[]).includes(value);
}

export function isExclusionReason(value: unknown): value is ExclusionReason {
  return typeof value === 'string' && (EXCLUSION_REASONS as readonly string[]).includes(value);
}

/**
 * Marca minima de uma atividade 'deleted': tudo que mede o treino vira nulo. Mesmo que algum leitor esquecesse o filtro central, a linha nao conta km, tempo,
 * frequencia cardiaca nem rota. Permanecem so' provedor, id externo, data de inicio e esporte (necessarios para a sincronizacao nao reimportar).
 */
export function tombstoneMetricsPatch() {
  return {
    durationSec: null,
    distanceMeters: null,
    caloriesKcal: null,
    avgHeartRateBpm: null,
    maxHeartRateBpm: null,
    cadenceAvg: null,
    powerAvgWatts: null,
    elevationGainMeters: null,
    hasRoute: false,
    detailFetchedAt: null,
    // Colunas Json: o Prisma exige Prisma.JsonNull (e nao null) para limpar.
    providerMetrics: Prisma.JsonNull,
    physicalIdentityEvidence: Prisma.JsonNull,
    physicalCanonicalReason: Prisma.JsonNull,
  };
}

const SPORT_LABEL: Record<string, string> = { corrida: 'corrida', esteira: 'corrida na esteira', caminhada: 'caminhada', forca: 'treino de força', ciclismo: 'pedalada', bike: 'pedalada', natacao: 'natação' };

/**
 * Aviso curto que vai ao Prontuario (e dai ao treinador e a IA): diz QUE uma atividade foi retirada da analise, sem repetir os numeros dela. Assim a IA nao
 * "inventa" a atividade nem toma a ausencia por falta de treino, e o dado retirado continua fora da analise.
 */
export function exclusionProfileNote(params: { mode: ExclusionMode; actorRole: 'student' | 'coach'; sport: string | null; startedAt: Date; utcOffsetMinutes: number | null; reason: ExclusionReason; count: number }): { header: string; body: string } {
  const date = activityLocalDate(params.startedAt, params.utcOffsetMinutes).split('-').reverse().join('/');
  const by = params.actorRole === 'coach' ? 'pelo treinador' : 'pela própria aluna';
  const kind = params.sport ? SPORT_LABEL[params.sport] ?? 'atividade' : 'atividade';
  const what = params.count > 1 ? `${params.count} registros da mesma ${kind}` : `uma ${kind}`;
  const verb = params.mode === 'deleted' ? 'excluída' : 'ignorada';
  return {
    header: `Atividade retirada da análise em ${new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}, feito ${by}.`,
    body: `${what.charAt(0).toUpperCase()}${what.slice(1)} do dia ${date} foi ${verb} (motivo: ${EXCLUSION_REASON_LABEL[params.reason]}). Os dados dessa atividade não entram mais em nenhuma análise; a ausência dela não indica falta de treino.`,
  };
}
