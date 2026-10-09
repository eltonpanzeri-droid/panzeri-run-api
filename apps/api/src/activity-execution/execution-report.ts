import {
  EXECUTION_ANALYSIS_VERSION, mergeTimeInBand, RunExecutionAnalysis, Scenario, SegmentRole, SessionAnalysis, StrengthExecutionAnalysis, TimeInBand,
} from './execution-analysis';

// RELATORIOS (Etapa 2.1): texto do aluno montado DIRETAMENTE dos indicadores calculados em execution-analysis.ts — nenhuma chamada de IA e nenhum
// segundo motor de calculo. O semanal agrega os MESMOS indicadores (somando SEGUNDOS, nunca medias de percentuais) e o texto so' apresenta.

const fmtKm = (km: number) => km.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const fmtInt = (n: number) => String(Math.round(n));
const pct = (v: number | null) => (v == null ? '?' : `${Math.round(v)}%`);
const ROLE_LABEL: Record<SegmentRole, string> = { estimulo: 'Nos blocos de maior intensidade', recuperacao: 'Nas recuperações', continuo: 'Ao longo do treino' };
const ROLE_ORDER: SegmentRole[] = ['estimulo', 'continuo', 'recuperacao'];

function bandSentence(prefix: string, tib: TimeInBand): string {
  return `${prefix}, permaneceu ${pct(tib.inPct)} do tempo dentro da faixa prescrita, ${pct(tib.slowPct)} mais lento e ${pct(tib.fastPct)} mais rápido.`;
}

function structureSentence(run: RunExecutionAnalysis): string | null {
  const s = run.structure;
  const reps = s.evidence?.repsPrescribed ?? 0;
  if (s.prescribed === 'intervalado') {
    switch (s.scenario) {
      case 'E': return `A estrutura prevista (${reps} alternâncias entre esforço e recuperação) foi reconhecida na execução.`;
      case 'A': return 'As alternâncias entre esforço e recuperação estiveram presentes, mas os ritmos ficaram fora das faixas prescritas.';
      case 'B': return `O treino apresentou ritmo predominantemente contínuo, embora a prescrição previsse ${reps} alternâncias entre esforço e recuperação.`;
      case 'C': return `Foram reconhecidas ${s.evidence?.repsRecognized ?? 0} das ${s.evidence?.repsEvaluated ?? 0} repetições que puderam ser avaliadas (${reps} previstas); a estrutura não se manteve em todo o treino.`;
      case 'D': return 'O ritmo foi predominantemente contínuo, com aumento sustentado de velocidade no final, sem reproduzir as alternâncias previstas.';
      case 'F': return 'Não há dados suficientes para classificar a estrutura do treino com confiança.';
      default: return null;
    }
  }
  if (s.executed === 'continuo_com_aceleracao_final') return 'Houve aumento sustentado de velocidade no trecho final do treino.';
  return null;
}

export function renderSessionReport(analysis: SessionAnalysis): string[] {
  if (analysis.kind === 'not_done') return [analysis.reason === 'marcada_como_nao_feita' ? 'Este treino foi marcado como não realizado.' : 'Não há registro de execução deste treino.'];
  if (analysis.kind === 'strength') return renderStrength(analysis);
  return renderRun(analysis);
}

function renderRun(run: RunExecutionAnalysis): string[] {
  const lines: string[] = [];
  const t = run.totals;
  if (t.realizedKm != null && t.prescribedKm != null) lines.push(`Você percorreu ${fmtKm(t.realizedKm)} dos ${fmtKm(t.prescribedKm)} km previstos${run.dataLevel === 'manual_only' ? ' (registro manual)' : ''}.`);
  else if (t.realizedKm != null) lines.push(`Você percorreu ${fmtKm(t.realizedKm)} km${run.dataLevel === 'manual_only' ? ' (registro manual)' : ''}.`);
  if (run.blocks && run.intensity.status !== 'indeterminado') {
    for (const role of ROLE_ORDER) {
      const tib = run.intensity.byRole[role];
      if (tib && tib.inPct != null) lines.push(bandSentence(ROLE_LABEL[role], tib));
    }
    if (run.coverage?.coveragePct != null && run.coverage.coveragePct < 80) lines.push(`Esses percentuais consideram os ${fmtInt(run.coverage.coveragePct)}% do tempo com dados confiáveis.`);
  }
  const structure = structureSentence(run);
  if (structure) lines.push(structure);
  const vitals: string[] = [];
  if (t.avgHeartRateBpm != null) vitals.push(`frequência cardíaca média de ${fmtInt(t.avgHeartRateBpm)} bpm`);
  if (t.avgCadenceSpm != null) vitals.push(`cadência média de ${fmtInt(t.avgCadenceSpm)} passos/min`);
  if (vitals.length > 0) lines.push(`Registros do relógio: ${vitals.join(' e ')}.`);
  if (run.blocksLimitation === 'prescricao_sem_blocos_por_distancia') lines.push('A prescrição deste treino é por tempo: a comparação por blocos e a distribuição por faixa de ritmo não estão disponíveis.');
  if (run.blocksLimitation === 'sem_serie_temporal') lines.push(run.dataLevel === 'summary_only' ? 'O relógio enviou apenas o resumo do treino: a distribuição por faixa de ritmo não pôde ser calculada.' : 'Sem dados do relógio, apresentamos apenas o que você registrou.');
  if (t.perceivedEffort != null) lines.push(`Esforço percebido informado: ${fmtInt(t.perceivedEffort)}/10.`);
  return lines.length > 0 ? lines : ['Sem dados suficientes para comparar este treino com o previsto.'];
}

function renderStrength(s: StrengthExecutionAnalysis): string[] {
  const lines: string[] = [];
  if (s.realizedDurationMin != null && s.prescribedDurationMin != null) {
    const verdict = s.durationClass === 'proxima' ? 'próxima da prevista' : s.durationClass === 'mais_curta' ? 'mais curta que a prevista' : 'mais longa que a prevista';
    lines.push(`Duração registrada: ${fmtInt(s.realizedDurationMin)} min, ${verdict} (${fmtInt(s.prescribedDurationMin)} min; tolerância de ${Math.round(s.tolerance * 100)}%).`);
  } else if (s.realizedDurationMin != null) lines.push(`Duração registrada: ${fmtInt(s.realizedDurationMin)} min.`);
  if (s.perceivedEffort != null) lines.push(`Esforço percebido informado: ${fmtInt(s.perceivedEffort)}/10.`);
  const device: string[] = [];
  if (s.avgHeartRateBpm != null) device.push(`frequência cardíaca média de ${fmtInt(s.avgHeartRateBpm)} bpm`);
  if (s.caloriesKcal != null) device.push(`gasto energético estimado pelo relógio de ${fmtInt(s.caloriesKcal)} kcal`);
  if (device.length > 0) lines.push(`Registros do relógio: ${device.join(' e ')}.`);
  return lines.length > 0 ? lines : ['Sem dados suficientes para comparar este treino com o previsto.'];
}

// ── semana ──────────────────────────────────────────────────────────────────────────────────────────────────────

export interface WeeklySessionInput {
  sessionId: string;
  scheduledDate: string;
  modality: string;
  kind: 'run' | 'strength' | 'other';
  analysis: SessionAnalysis;
  activityLogId: string | null;
  provider: string | null;
}

export interface WeeklyExecutionIndicators {
  version: number;
  weekStartDate: string;
  overview: { prescribed: number; performed: number; notPerformed: number; noRecord: number; frequencyPct: number | null; byModality: Record<string, { prescribed: number; performed: number }> };
  strength: { prescribed: number; performed: number; durationClasses: { proxima: number; mais_curta: number; mais_longa: number; sem_dado: number }; effortAvg: number | null; effortMin: number | null; effortMax: number | null; effortN: number; caloriesTotalKcal: number | null; caloriesN: number } | null;
  run: {
    prescribed: number; performed: number; prescribedKmAll: number | null; prescribedKmPerformed: number | null; realizedKm: number | null; sessionsWithDistance: number;
    // distribuicao de tempo pelas faixas PRESCRITAS de cada bloco, somando segundos por papel (estimulo/recuperacao/continuo) — papeis nunca se misturam
    intensityByRole: Partial<Record<SegmentRole, TimeInBand>>; sessionsWithBands: number;
    structure: { intervalPrescribed: number; classified: number; scenarios: Partial<Record<Scenario, number>> };
    fidelity: { analyzable: number; intensityWithin: number; structureCompatible: number };
  } | null;
  completeness: { sessionsWithoutData: number; summaryOnly: number; manualOnly: number; notes: string[] };
  sources: { sessionIds: string[]; activityLogIds: string[]; providers: string[] };
}

const add = <T>(a: number | null, b: T | null | undefined, pick: (x: T) => number | null) => { const v = b == null ? null : pick(b); return v == null ? a : (a ?? 0) + v; };

export function buildWeeklyExecutionIndicators(weekStartDate: string, sessions: WeeklySessionInput[]): WeeklyExecutionIndicators {
  const performedOf = (s: WeeklySessionInput) => s.analysis.kind !== 'not_done';
  const byModality: Record<string, { prescribed: number; performed: number }> = {};
  for (const s of sessions) { const m = (byModality[s.modality] ??= { prescribed: 0, performed: 0 }); m.prescribed++; if (performedOf(s)) m.performed++; }
  const performed = sessions.filter(performedOf).length;
  const notPerformed = sessions.filter((s) => s.analysis.kind === 'not_done' && s.analysis.reason === 'marcada_como_nao_feita').length;
  const noRecord = sessions.filter((s) => s.analysis.kind === 'not_done' && s.analysis.reason === 'sem_registro').length;

  const strengthSessions = sessions.filter((s) => s.kind === 'strength');
  const strengthDone = strengthSessions.filter((s) => s.analysis.kind === 'strength').map((s) => s.analysis as StrengthExecutionAnalysis);
  const efforts = strengthDone.map((s) => s.perceivedEffort).filter((v): v is number => v != null);
  const calories = strengthDone.map((s) => s.caloriesKcal).filter((v): v is number => v != null);
  const strength = strengthSessions.length === 0 ? null : {
    prescribed: strengthSessions.length, performed: strengthDone.length,
    durationClasses: {
      proxima: strengthDone.filter((s) => s.durationClass === 'proxima').length, mais_curta: strengthDone.filter((s) => s.durationClass === 'mais_curta').length,
      mais_longa: strengthDone.filter((s) => s.durationClass === 'mais_longa').length, sem_dado: strengthDone.filter((s) => s.durationClass == null).length,
    },
    effortAvg: efforts.length > 0 ? Math.round((efforts.reduce((a, b) => a + b, 0) / efforts.length) * 10) / 10 : null,
    effortMin: efforts.length > 0 ? Math.min(...efforts) : null, effortMax: efforts.length > 0 ? Math.max(...efforts) : null, effortN: efforts.length,
    caloriesTotalKcal: calories.length > 0 ? Math.round(calories.reduce((a, b) => a + b, 0)) : null, caloriesN: calories.length,
  };

  const runSessions = sessions.filter((s) => s.kind === 'run');
  const runDone = runSessions.filter((s) => s.analysis.kind === 'run').map((s) => s.analysis as RunExecutionAnalysis);
  const withBands = runDone.filter((r) => r.dataLevel === 'series' && r.intensity.overall != null);
  const intensityByRole: Partial<Record<SegmentRole, TimeInBand>> = {};
  for (const role of ['estimulo', 'recuperacao', 'continuo'] as SegmentRole[]) {
    const merged = mergeTimeInBand(withBands.map((r) => r.intensity.byRole[role]));
    if (merged) intensityByRole[role] = merged;
  }
  const scenarios: Partial<Record<Scenario, number>> = {};
  let classified = 0;
  for (const r of runDone) if (r.structure.prescribed === 'intervalado' && r.structure.scenario) { scenarios[r.structure.scenario] = (scenarios[r.structure.scenario] ?? 0) + 1; classified++; }
  const analyzable = withBands.filter((r) => r.intensity.status !== 'indeterminado');
  const prescribedKmAll = runSessions.reduce<number | null>((acc, s) => add(acc, s.analysis.kind === 'run' || s.analysis.kind === 'not_done' ? s.analysis : null, (a) => (a.kind === 'run' ? a.totals.prescribedKm : a.prescribedKm)), null);
  const run = runSessions.length === 0 ? null : {
    prescribed: runSessions.length, performed: runDone.length,
    prescribedKmAll: prescribedKmAll != null ? Math.round(prescribedKmAll * 10) / 10 : null,
    prescribedKmPerformed: (() => { const v = runDone.reduce<number | null>((acc, r) => add(acc, r, (x) => x.totals.realizedKm != null ? x.totals.prescribedKm : null), null); return v != null ? Math.round(v * 10) / 10 : null; })(),
    realizedKm: (() => { const v = runDone.reduce<number | null>((acc, r) => add(acc, r, (x) => x.totals.realizedKm), null); return v != null ? Math.round(v * 10) / 10 : null; })(),
    sessionsWithDistance: runDone.filter((r) => r.totals.realizedKm != null).length,
    intensityByRole, sessionsWithBands: withBands.length,
    structure: { intervalPrescribed: runDone.filter((r) => r.structure.prescribed === 'intervalado').length, classified, scenarios },
    fidelity: { analyzable: analyzable.length, intensityWithin: analyzable.filter((r) => r.intensity.status === 'dentro').length, structureCompatible: runDone.filter((r) => r.structure.scenario === 'E').length },
  };
  const summaryOnly = runDone.filter((r) => r.dataLevel === 'summary_only').length;
  const manualOnly = runDone.filter((r) => r.dataLevel === 'manual_only').length + strengthDone.filter((s) => s.dataLevel === 'manual_only').length;
  const withoutData = sessions.filter((s) => s.analysis.kind === 'run' && s.analysis.dataLevel === 'none').length;
  const notes: string[] = [];
  if (summaryOnly > 0) notes.push(`${summaryOnly} treino(s) de corrida só com o resumo do relógio (sem distribuição por faixa).`);
  if (manualOnly > 0) notes.push(`${manualOnly} treino(s) só com registro manual.`);
  if (noRecord > 0) notes.push(`${noRecord} treino(s) sem registro (não é o mesmo que não realizado).`);
  const providers = [...new Set(sessions.map((s) => s.provider).filter((p): p is string => !!p))].sort();
  return {
    version: EXECUTION_ANALYSIS_VERSION, weekStartDate,
    overview: { prescribed: sessions.length, performed, notPerformed, noRecord, frequencyPct: sessions.length > 0 ? Math.round((performed / sessions.length) * 100) : null, byModality },
    strength, run, completeness: { sessionsWithoutData: withoutData, summaryOnly, manualOnly, notes },
    sources: { sessionIds: sessions.map((s) => s.sessionId), activityLogIds: sessions.map((s) => s.activityLogId).filter((id): id is string => !!id), providers },
  };
}

const MODALITY_LABEL: Record<string, string> = { corrida: 'corrida', esteira: 'corrida', forca: 'musculação', fortalecimento_corredores: 'fortalecimento' };

export function renderWeeklyReport(ind: WeeklyExecutionIndicators): string[] {
  const lines: string[] = [];
  const o = ind.overview;
  if (o.prescribed === 0) return ['Não havia treinos prescritos na semana anterior.'];
  const parts = Object.entries(o.byModality).filter(([, v]) => v.performed > 0).map(([m, v]) => `${v.performed} de ${MODALITY_LABEL[m] ?? m}`);
  lines.push(o.performed === o.prescribed
    ? `Você realizou os ${o.prescribed} treinos previstos${parts.length > 0 ? `: ${parts.join(' e ')}` : ''}.`
    : `Você realizou ${o.performed} dos ${o.prescribed} treinos previstos${parts.length > 0 ? ` (${parts.join(' e ')})` : ''}${o.noRecord > 0 ? `; ${o.noRecord} sem registro` : ''}.`);
  const s = ind.strength;
  if (s && s.performed > 0) {
    const c = s.durationClasses;
    const bits = [c.proxima > 0 ? `${c.proxima} com duração próxima à planejada` : null, c.mais_curta > 0 ? `${c.mais_curta} mais curta${c.mais_curta > 1 ? 's' : ''}` : null, c.mais_longa > 0 ? `${c.mais_longa} mais longa${c.mais_longa > 1 ? 's' : ''}` : null].filter(Boolean);
    lines.push(`Na musculação, ${s.performed} sessão(ões)${bits.length > 0 ? `: ${bits.join(', ')}` : ''}.${s.effortAvg != null ? ` O esforço percebido médio foi ${String(s.effortAvg).replace('.', ',')}/10${s.effortN > 1 ? `, com registros de ${s.effortMin} e ${s.effortMax}` : ''}.` : ''}${s.caloriesTotalKcal != null ? ` Gasto energético estimado pelo relógio: ${s.caloriesTotalKcal} kcal (${s.caloriesN} sessão(ões) com o dado).` : ''}`);
  }
  const r = ind.run;
  if (r && r.performed > 0) {
    const km = r.realizedKm != null && r.prescribedKmAll != null ? ` Percorreu ${fmtKm(r.realizedKm)} dos ${fmtKm(r.prescribedKmAll)} km previstos${r.sessionsWithDistance < r.performed ? ` (distância conhecida em ${r.sessionsWithDistance} de ${r.performed} treinos)` : ''}.` : '';
    lines.push(`Na corrida, ${r.performed} de ${r.prescribed} sessões.${km}`);
    for (const role of ROLE_ORDER) {
      const tib = r.intensityByRole[role];
      if (tib && tib.inPct != null) lines.push(`${ROLE_LABEL[role]} (soma do tempo de ${r.sessionsWithBands} treino(s) com dados, cada bloco comparado à própria faixa prescrita): ${pct(tib.inPct)} dentro da faixa, ${pct(tib.slowPct)} mais lento, ${pct(tib.fastPct)} mais rápido.`);
    }
    const sc = r.structure.scenarios;
    if (r.structure.intervalPrescribed > 0) {
      const changed = (sc.B ?? 0) + (sc.D ?? 0) + (sc.C ?? 0);
      if (r.structure.classified === 0) lines.push(`${r.structure.intervalPrescribed} treino(s) intervalado(s) previsto(s), sem dados suficientes para avaliar a estrutura.`);
      else lines.push(changed > 0 ? `Dos ${r.structure.classified} treinos intervalados avaliados, ${changed} não reproduziram a estrutura prevista (${[sc.B ? `${sc.B} em ritmo contínuo` : null, sc.C ? `${sc.C} parcialmente` : null, sc.D ? `${sc.D} contínuo com aceleração final` : null].filter(Boolean).join(', ')}).` : `Os ${r.structure.classified} treinos intervalados avaliados reproduziram a estrutura prevista${sc.A ? `, ${sc.A} com ritmos fora das faixas` : ''}.`);
    }
  }
  for (const note of ind.completeness.notes) lines.push(note);
  return lines;
}
