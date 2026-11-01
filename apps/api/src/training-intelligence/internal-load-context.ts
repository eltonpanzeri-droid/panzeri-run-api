import {
  addDays, buildTrainingLoad, classifySessions, compareSessionToReference, loadModalityKey, modalityGroup,
  type LoadGroup, type LoadInputRow, type LoadSession, type LoadViewResult, type SessionComparison, type SessionReferenceView,
} from '../coach/training-load';
import { INTERNAL_LOAD_VARIABLE_ID } from './internal-load';
import type { TrainingIntelligenceQueryService } from './training-intelligence-query.service';

// Carga interna percebida no contexto da IA e no painel (01/11/2026). Funções que MONTAM, sem inventar nada, o que já está calculado pela fonte única (coach/training-load.ts) e pelas referências
// só-com-sessões-anteriores (reference-series.ts). Nada aqui decide treino: o contexto entrega PSE, duração e carga SEPARADAS, por modalidade, com a comparação da última sessão contra o histórico
// ANTERIOR a ela e a carga acumulada (7 e 28 dias); a interpretação é do agente, com as demais evidências.
const CHART_POINTS = 60;
const RECENT_SESSIONS = 6;
const RECENT_WEEKS = 6;
const GROUP_LABEL: Record<LoadGroup, string> = { corrida: 'corrida', forca: 'musculacao_e_forca', outras: 'outras_modalidades' };

/** Referências (só sessões anteriores) da sessão mais recente de cada modalidade, e a série curta para o gráfico por sessão. Falha da camada matemática não derruba nada: o grupo fica sem comparação. */
export async function buildSessionReferences(
  ti: Pick<TrainingIntelligenceQueryService, 'getVariableSnapshot'> | undefined,
  studentId: string,
  sessions: LoadSession[],
): Promise<Partial<Record<LoadGroup, SessionReferenceView>> | null> {
  if (!ti || sessions.length === 0) return null;
  const out: Partial<Record<LoadGroup, SessionReferenceView>> = {};
  for (const group of ['corrida', 'forca', 'outras'] as const) {
    const ofGroup = sessions.filter((s) => modalityGroup(s.modality) === group);
    if (ofGroup.length === 0) continue;
    const modalities = [...new Set(ofGroup.map((s) => loadModalityKey(s.modality)))].sort();
    try {
      const snapshot = await ti.getVariableSnapshot(studentId, INTERNAL_LOAD_VARIABLE_ID, modalities, undefined, { withReference: true });
      const reference = snapshot.reference;
      if (!reference || reference.points.length === 0) continue;
      const lastPoint = reference.points[reference.points.length - 1];
      const lastDate = ofGroup.reduce((best, s) => (s.date > best ? s.date : best), '');
      const sameDay = ofGroup.filter((s) => s.date === lastDate);
      const lastSession = sameDay.find((s) => s.load === lastPoint.value) ?? sameDay[sameDay.length - 1];
      out[group] = {
        group,
        modalities,
        eligibleSessions: ofGroup.length,
        unit: reference.unit,
        windows: reference.windows.map(({ key, label }) => ({ key, label })),
        bandPolicy: reference.bandPolicy,
        last: compareSessionToReference(lastSession, lastPoint, reference),
        points: reference.points.slice(-CHART_POINTS).map((p) => {
          const day = p.timestamp.slice(0, 10);
          const match = ofGroup.find((s) => s.date === day && s.load === p.value);
          return { date: day, load: p.value, rpe: match?.rpe ?? null, minutes: match?.minutes ?? null, mm7: p.movingAverages.mm7.value, lower: p.band.lower, upper: p.band.upper, signal: p.signal };
        }),
      };
    } catch { /* sem a camada matematica a comparacao nao existe; a carga em si continua valendo */ }
  }
  return Object.keys(out).length > 0 ? out : null;
}

const POSITION: Record<SessionComparison['signal'], string> = { above: 'acima_da_faixa_habitual', below: 'abaixo_da_faixa_habitual', within: 'dentro_da_faixa_habitual', no_reference: 'sem_referencia_suficiente' };
const BASIS: Record<SessionComparison['band']['basis'], string> = { individual: 'individual', limited: 'limitada_poucas_sessoes', none: 'sem_faixa_amostra_insuficiente' };

const diffBlock = (d: SessionComparison['vsHistoricalMean']) => (d == null ? null : { absolutaUA: d.absolute, percentual: d.percent });

function windowBlock(view: LoadViewResult) {
  const w = view.current;
  return {
    aguda7dUA: w.acuteLoad,
    cronicaMediaSemanal28dUA: w.chronicWeeklyAverage,
    razaoAgudaCronica: w.ratio, // null = nao existe (historico curto, pouca amostra ou denominador nulo); nunca e' zero nem estimada
    treinosNos28d: w.sessionsInWindow,
    treinosForaDoCalculoNos28d: w.excludedInWindow,
    diasDeHistoricoNaJanelaCronica: w.chronicDaysCovered,
    observacao: w.note,
  };
}

function lastSessionBlock(session: LoadSession, comparison: SessionComparison | undefined) {
  const base = {
    data: session.date,
    modalidade: loadModalityKey(session.modality),
    pse: session.rpe,
    duracaoMin: session.minutes,
    origemDuracao: session.durationSource === 'atividade_importada' ? 'atividade_importada_do_relogio' : 'informada_pela_aluna',
    cargaUA: session.load,
  };
  if (!comparison) return { ...base, comparacao: 'indisponivel' };
  return {
    ...base,
    sessoesAnterioresDaModalidade: comparison.priorN, // a sessao investigada NAO entra nas medias e na faixa abaixo
    mediaHistoricaAnteriorUA: comparison.historicalMean.value,
    mediasMoveisAnterioresUA: comparison.movingAverages.map((m) => ({ janela: m.label, valorUA: m.value, n: m.n })),
    faixaHabitualUA: { inferior: comparison.band.lower, superior: comparison.band.upper, base: BASIS[comparison.band.basis], nSessoes: comparison.band.n },
    posicaoNaFaixa: POSITION[comparison.signal], // descritivo e NEUTRO: nao e melhora nem piora, nem bom/ruim
    diferencaParaMediaHistorica: diffBlock(comparison.vsHistoricalMean),
    diferencaParaMediaMovel7: diffBlock(comparison.vsMoving7),
    amostraSuficiente: comparison.sufficient,
  };
}

/** Bloco `cargaInternaPercebida` do contexto da IA. null quando a aluna não tem nenhuma sessão elegível (nada de bloco vazio). */
export function buildInternalLoadContext(rows: LoadInputRow[], today: string, references: Partial<Record<LoadGroup, SessionReferenceView>> | null) {
  const { sessions, excluded } = classifySessions(rows);
  if (sessions.length === 0 && excluded.length === 0) return null;
  const result = buildTrainingLoad(rows, { from: addDays(today, -(RECENT_WEEKS * 7 + 6)), to: today }, today);
  const porModalidade: Record<string, unknown> = {};
  for (const group of ['corrida', 'forca', 'outras'] as const) {
    const ofGroup = sessions.filter((s) => modalityGroup(s.modality) === group);
    if (ofGroup.length === 0) continue;
    const reference = references?.[group];
    // sessions ja vem ordenadas por data e id; quando ha comparacao, a sessao investigada e' exatamente a que ela mediu
    const last = (reference?.last ? ofGroup.find((s) => s.id === reference.last!.id) : undefined) ?? ofGroup[ofGroup.length - 1];
    const view = result.views[group];
    const firstDate = ofGroup[0].date; // sessions ja vem ordenadas por data
    porModalidade[GROUP_LABEL[group]] = {
      modalidadesReunidas: [...new Set(ofGroup.map((s) => loadModalityKey(s.modality)))].sort(),
      sessoesElegiveisNoHistorico: ofGroup.length,
      ultimaSessao: lastSessionBlock(last, reference?.last ?? undefined),
      ultimasSessoes: ofGroup.slice(-RECENT_SESSIONS).map((s) => ({ data: s.date, pse: s.rpe, duracaoMin: s.minutes, cargaUA: s.load })),
      cargaAcumulada: windowBlock(view),
      // Semanas ANTES do primeiro treino da modalidade nao entram: ausencia de historico nao e' "0 UA".
      cargaSemanalUA: view.weeks.filter((w) => w.weekEnd >= firstDate).slice(-RECENT_WEEKS).map((w) => ({ semanaIniciadaEm: w.weekStart, cargaUA: w.load, treinos: w.sessions, semanaEmAndamento: w.inProgress })),
    };
  }
  return {
    metodo: {
      versao: result.method.version,
      formula: 'carga interna percebida (UA) = PSE da sessao (1 a 10) x duracao em minutos; PSE, duracao e carga sao informadas SEPARADAMENTE',
      janelas: 'aguda = soma dos ultimos 7 dias; cronica = soma dos ultimos 28 dias / 4 (media semanal); razao = aguda / cronica, so quando ha 28 dias de historico e pelo menos 10 treinos na janela',
      comparacaoDaSessao: 'a ultima sessao e comparada so com sessoes ANTERIORES da MESMA modalidade (ela nao entra nas proprias medias e faixa)',
    },
    porModalidade,
    agregadoGeral: { aviso: 'soma de cargas de modalidades diferentes (visao agregada): nao substitui a leitura por modalidade', ...windowBlock(result.views.geral) },
    qualidadeDosDados: { treinosFeitosSemPseOuDuracaoNoPeriodo: excluded.length, observacao: 'treino sem PSE ou sem duracao utilizavel fica FORA do calculo (nunca vira zero nem e estimado)' },
    referenciaEm: today,
  };
}

export type InternalLoadContext = NonNullable<ReturnType<typeof buildInternalLoadContext>>;
