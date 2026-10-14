import { Prisma } from '@prisma/client';
import type { EvolutionSeries } from '../evolution/evolution.types';
import type { MedalCategory } from './medal-catalog';
import { isoDate, mondayOf } from './medal-evaluation.helpers';
import type { UnlockCandidate } from './medal-evaluation.service';
import {
  awardPeriod, day, differentValue, earlierUncertainty, ExistingVolumeAward, isAwardRevoked, periodHasEvidence, uncertainInAwardPeriod, VOLUME_CATEGORIES,
} from './volume-reconciliation';

// Decisao PURA sobre o que fazer com cada concessao de medalha depois que uma correcao muda os dados (15/10/2026, etapa 3 do plano). Nao le banco, nao grava,
// nao e' chamada por nenhum fluxo ainda: a revogacao so' e' ativada numa etapa posterior (allowRevocation), e por padrao a funcao APENAS RECOMENDA 'review'
// onde revogaria. Reaproveita as regras e auxiliares do mecanismo de retracao de volume (volume-reconciliation.ts) em vez de criar outro: a diferenca e' que
// aqui o gatilho da retracao e' "o criterio deixou de ser atendido num periodo tocado pela correcao" (nao o calculo duplicado conhecido da reconciliacao).
//
// Principios (decisoes do treinador, 15/10/2026):
// - Corrigir uma atividade NAO e' perder a medalha: so' revoga quando o criterio efetivamente deixou de ser atendido, respeitando a semantica da conquista.
// - Regra versionada: concessao sob versao de regra diferente da do catalogo nunca e' reavaliada automaticamente (vira 'review').
// - Ausencia de dado NAO e' prova: periodo incerto ou sem observacoes => 'review', nunca revoga.
// - So' se reavalia o que a correcao tocou; falha de criterio fora do escopo e' inconsistencia anterior => 'review'.
// - Reativar nunca perde historico: a acao carrega a concessao existente (a persistencia futura preserva unlockedAt e registra a transicao).

export type AwardActionKind = 'keep' | 'create' | 'adjust' | 'revoke' | 'reactivate' | 'review';

export type AwardReason =
  | 'criterio_mantido'
  | 'periodo_ou_valor_diferente'
  | 'criterio_nao_atendido'
  | 'criterio_voltou_a_ser_atendido'
  | 'conquista_comprovada_nao_registrada'
  | 'segue_revogada'
  | 'versao_ou_catalogo_divergente'
  | 'periodo_incerto'
  | 'periodo_incerto_ou_sem_observacoes'
  | 'fora_do_escopo_da_correcao'
  | 'periodo_nao_determinado'
  | 'revogacao_desativada'
  | 'ausencia_de_dados_nao_e_prova'
  | 'catalogo_inativo';

export interface AwardAction {
  kind: AwardActionKind;
  code: string;
  reason: AwardReason;
  existing?: ExistingAward;
  candidate?: UnlockCandidate;
  // Presente quando a funcao revogaria mas allowRevocation esta desligado.
  wouldRevoke?: boolean;
}

export interface ExistingAward extends ExistingVolumeAward {
  category: MedalCategory | string;
}

export interface CatalogEntry {
  code: string;
  category: MedalCategory | string;
  active: boolean;
  ruleVersion: number;
}

/** O que a correcao tocou. Semanas = segundas-feiras ISO (YYYY-MM-DD); meses = YYYY-MM. */
export interface CorrectionScope {
  weeks: ReadonlySet<string>;
  months: ReadonlySet<string>;
  // Linhas de feedback (WorkoutCompletion) foram criadas/movidas/apagadas: afeta contagens, constancia, retomada e acumulado.
  countsChanged: boolean;
}

export interface AwardReevaluationInput {
  existing: ExistingAward[];
  candidates: UnlockCandidate[];
  catalog: CatalogEntry[];
  // Categorias efetivamente reavaliadas (candidates cobrem so' elas). Concessao de outra categoria nunca recebe acao.
  evaluatedCategories: ReadonlySet<string>;
  scope: CorrectionScope;
  // Semanas/meses de corrida com origem incerta (EvolutionMetricService.getRunMedalUncertainty) e a serie canonica — usados so' nas categorias de volume.
  uncertainty?: { weeks: ReadonlySet<string>; months: ReadonlySet<string> };
  series?: EvolutionSeries;
  allowRevocation?: boolean;
  // A reavaliacao decorre de AUSENCIA de dado (ex.: exclusao de dados do provedor), nao de correcao: ausencia nao prova que a conquista era invalida, entao nada
  // e' revogado nem ajustado (vira 'review'). Concessao nova e reativacao continuam possiveis (sao comprovadas por dado presente).
  absenceOfData?: boolean;
}

// Familias de semantica. 'count': total acumulado que atinge um limiar (valor = total, sem periodo). 'period': primeira vez que um periodo/sequencia/sessao
// atingiu o criterio (valor e periodo descrevem esse primeiro momento).
const COUNT_CATEGORIES = new Set<string>(['treinos_concluidos', 'feedbacks', 'checkins', 'reavaliacoes']);
const VOLUME = new Set<string>(VOLUME_CATEGORIES);

const asSet = <T>(values: ReadonlySet<T>) => values as Set<T>;

function evidenceString(award: ExistingAward, key: string): string | null {
  const evidence = award.evidence && typeof award.evidence === 'object' && !Array.isArray(award.evidence) ? (award.evidence as Prisma.JsonObject) : {};
  const value = evidence[key];
  return typeof value === 'string' ? value : null;
}

const mondayIso = (iso: string): string => isoDate(mondayOf(new Date(`${iso.slice(0, 10)}T00:00:00.000Z`)));

function weeksEndingAt(endIso: string, count: number): string[] {
  const end = Date.parse(`${endIso}T00:00:00Z`);
  if (!Number.isFinite(end) || !Number.isInteger(count) || count < 1) return [];
  return Array.from({ length: count }, (_, index) => new Date(end - index * 7 * 86_400_000).toISOString().slice(0, 10));
}

type Touch = boolean | null; // null = nao foi possivel determinar o periodo da concessao

/** A concessao depende de algo que a correcao tocou? null quando o periodo dela nao pode ser determinado (decisao conservadora: 'review'). */
function touchesScope(award: ExistingAward, scope: CorrectionScope): Touch {
  const category = award.category;
  if (COUNT_CATEGORIES.has(category)) return scope.countsChanged;
  if (category === 'retomada') return scope.countsChanged; // depende das datas das sessoes concluidas
  if (category === 'acumulado') {
    // soma tudo ate o momento em que o limiar foi atingido: qualquer semana corrigida ate la, ou mudanca de feedback, pode alterar o resultado
    const end = day(award.periodEnd);
    if (!end) return null;
    const endWeek = mondayIso(end);
    return scope.countsChanged || [...scope.weeks].some((week) => week <= endWeek);
  }
  if (category === 'volume_semanal') {
    const week = awardPeriod(award);
    return week ? scope.weeks.has(week) : null;
  }
  if (category === 'volume_mensal') {
    const month = awardPeriod(award);
    return month ? scope.months.has(month) : null;
  }
  if (category === 'distancia_unica') {
    const date = day(award.periodStart);
    return date ? scope.weeks.has(mondayIso(date)) || scope.countsChanged : null;
  }
  if (category === 'sustentacao_volume' || category === 'constancia' || category === 'aderencia') {
    const end = category === 'sustentacao_volume' ? awardPeriod(award) : (evidenceString(award, 'endWeek') ?? evidenceString(award, 'weekStart') ?? day(award.periodEnd));
    if (!end) return null;
    const windowWeeks = weeksEndingAt(end.slice(0, 10), Math.max(1, award.threshold ?? 1));
    if (windowWeeks.length === 0) return null;
    return windowWeeks.some((week) => scope.weeks.has(week)) || (category === 'constancia' && scope.countsChanged);
  }
  return null;
}

function differs(award: ExistingAward, candidate: UnlockCandidate): boolean {
  if (COUNT_CATEGORIES.has(award.category)) return false; // valor = total na concessao (historico); so' o criterio importa
  return differentValue(award.value, candidate.value) || day(award.periodStart) !== day(candidate.periodStart) || day(award.periodEnd) !== day(candidate.periodEnd);
}

export function planAwardReevaluation(input: AwardReevaluationInput): AwardAction[] {
  const { evaluatedCategories, scope } = input;
  const byCandidate = new Map(input.candidates.map((candidate) => [candidate.code, candidate]));
  const byCatalog = new Map(input.catalog.map((entry) => [entry.code, entry]));
  const byExisting = new Map(input.existing.map((award) => [award.code, award]));
  const uncertainty = input.uncertainty ?? { weeks: new Set<string>(), months: new Set<string>() };
  const actions: AwardAction[] = [];

  for (const award of input.existing) {
    if (!evaluatedCategories.has(award.category)) continue;
    const candidate = byCandidate.get(award.code);
    const entry = byCatalog.get(award.code);
    const volume = VOLUME.has(award.category);

    if (!entry || award.awardedVersion !== award.catalogVersion || entry.ruleVersion !== award.awardedVersion) {
      actions.push({ kind: 'review', code: award.code, reason: 'versao_ou_catalogo_divergente', existing: award, candidate });
      continue;
    }

    if (isAwardRevoked(award)) {
      if (candidate && volume && earlierUncertainty(candidate, award.category, asSet(uncertainty.weeks), asSet(uncertainty.months))) {
        actions.push({ kind: 'review', code: award.code, reason: 'periodo_incerto', existing: award, candidate });
      } else if (candidate) {
        actions.push({ kind: 'reactivate', code: award.code, reason: 'criterio_voltou_a_ser_atendido', existing: award, candidate });
      } else {
        actions.push({ kind: 'keep', code: award.code, reason: 'segue_revogada', existing: award });
      }
      continue;
    }

    if (candidate) {
      if (volume && earlierUncertainty(candidate, award.category, asSet(uncertainty.weeks), asSet(uncertainty.months))) {
        actions.push({ kind: 'review', code: award.code, reason: 'periodo_incerto', existing: award, candidate });
      } else if (differs(award, candidate)) {
        actions.push(input.absenceOfData === true
          ? { kind: 'review', code: award.code, reason: 'ausencia_de_dados_nao_e_prova', existing: award, candidate }
          : { kind: 'adjust', code: award.code, reason: 'periodo_ou_valor_diferente', existing: award, candidate });
      } else {
        actions.push({ kind: 'keep', code: award.code, reason: 'criterio_mantido', existing: award, candidate });
      }
      continue;
    }

    // Sem candidato: o criterio deixou de ser atendido? So' revoga com prova.
    if (volume && (uncertainInAwardPeriod(award, asSet(uncertainty.weeks), asSet(uncertainty.months)) !== false || !input.series || !periodHasEvidence(award, input.series))) {
      actions.push({ kind: 'review', code: award.code, reason: 'periodo_incerto_ou_sem_observacoes', existing: award });
      continue;
    }
    const touched = touchesScope(award, scope);
    if (touched === null) {
      actions.push({ kind: 'review', code: award.code, reason: 'periodo_nao_determinado', existing: award });
    } else if (!touched) {
      actions.push({ kind: 'review', code: award.code, reason: 'fora_do_escopo_da_correcao', existing: award });
    } else if (input.absenceOfData === true) {
      actions.push({ kind: 'review', code: award.code, reason: 'ausencia_de_dados_nao_e_prova', existing: award, wouldRevoke: true });
    } else if (input.allowRevocation === true) {
      actions.push({ kind: 'revoke', code: award.code, reason: 'criterio_nao_atendido', existing: award });
    } else {
      actions.push({ kind: 'review', code: award.code, reason: 'revogacao_desativada', existing: award, wouldRevoke: true });
    }
  }

  for (const candidate of input.candidates) {
    if (byExisting.has(candidate.code)) continue;
    const entry = byCatalog.get(candidate.code);
    if (!entry || !evaluatedCategories.has(entry.category)) continue;
    if (!entry.active) {
      actions.push({ kind: 'review', code: candidate.code, reason: 'catalogo_inativo', candidate });
    } else if (VOLUME.has(entry.category) && earlierUncertainty(candidate, entry.category, asSet(uncertainty.weeks), asSet(uncertainty.months))) {
      actions.push({ kind: 'review', code: candidate.code, reason: 'periodo_incerto', candidate });
    } else {
      actions.push({ kind: 'create', code: candidate.code, reason: 'conquista_comprovada_nao_registrada', candidate });
    }
  }
  return actions;
}
