import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { DetailChart } from '../src/activityDetail';
import { fetchSnapshot, fetchSnapshots } from './homeApi';
import {
  SnapshotLite,
  WeekVolumeLite,
  WeeklyDescriptor,
  acuteChronicSentence,
  completeWeekPoints,
  describeVariable,
  formatPaceSeconds,
  recentVsLastSentences,
  sessionMeanSentences,
  volumeSentences,
  weeklySentences,
} from './insights';
import { dayFromIso, formatDayLabel, modalityName, movingAveragePoints, observationPoints, referenceChannelPoints } from './chartData';
import { IndicatorMeaning } from './IndicatorMeaning';
import { useIndicatorReading } from './evolutionReading';

// Secoes da tela "Evolucao objetiva do treinamento" (04/10/2026) que se somam ao volume
// prescrito/realizado/extra ja' existente em Progress (App.tsx): interpretacao em texto do volume,
// pace e cadencia. Tudo vem do motor longitudinal (variaveis training.* e activity.*) — nada e'
// recalculado aqui. Pace e cadencia sao OBJETIVOS (ActivityLog); sem dado valido, a secao diz isso
// em vez de mostrar grafico vazio ou zero.

// 02/11/2026 (lote 4): diferenca e razao realizado x prescrito (semanais) e % do tempo dentro da faixa de ritmo prescrita (por treino) entram na area "Evolucao do
// treinamento", lidos do servidor como os demais.
const IDS = [
  'training.volumeCompletedTotalKm',
  'training.volumeDiffAbsoluteKm',
  'training.volumeRatioCompletedPrescribed',
  'activity.avgPaceSecondsKm',
  'activity.weeklyAvgPaceSecondsKm',
  'activity.cadenceAvg',
  'execution.timeInBandPct',
] as const;

const PACE = { label: 'Ritmo médio', fmt: (v: number) => formatPaceSeconds(v) };
const CADENCE = { label: 'Cadência média', fmt: (v: number) => `${Math.round(v)} spm` };
const TIME_IN_BAND = { label: 'Tempo dentro da faixa de ritmo prescrita', fmt: (v: number) => `${Math.round(v)}%` };

const WEEKLY_PACE: WeeklyDescriptor = {
  fmt: (v) => formatPaceSeconds(v),
  lastLine: (v, c) => `seu ritmo médio foi de ${formatPaceSeconds(v)}${c?.numerator != null ? `, somando ${c.numerator} ${c.numerator === 1 ? 'corrida' : 'corridas'}` : ''}`,
};

const kmText = (v: number) => `${String(Math.round(Math.abs(v) * 10) / 10).replace('.', ',')} km`;
const DIFF: WeeklyDescriptor = {
  fmt: (v) => (Math.abs(v) < 0.05 ? '0 km' : `${v > 0 ? '+' : '−'}${kmText(v)}`),
  lastLine: (v) => (Math.abs(v) < 0.05 ? 'você realizou exatamente o volume prescrito' : `você realizou ${kmText(v)} ${v > 0 ? 'a mais' : 'a menos'} do que o prescrito`),
};
const RATIO: WeeklyDescriptor = {
  fmt: (v) => `${Math.round(v * 100)}%`,
  lastLine: (v) => `você realizou ${Math.round(v * 100)}% do volume prescrito`,
};

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View style={styles.card}>
      <Text style={styles.cardTitle}>{title}</Text>
      {children}
    </View>
  );
}

function Sentences({ items }: { items: string[] }) {
  if (items.length === 0) return null;
  return <View style={{ gap: 4 }}>{items.map((s) => <Text key={s} style={styles.sentence}>• {s}</Text>)}</View>;
}

function MetricCard({
  title,
  snapshot,
  descriptor,
  noun,
  emptyText,
  caution,
  unit,
  formatY,
  higherIsUp,
  masculine,
  subject,
  meaningId,
}: {
  title: string;
  snapshot: SnapshotLite | null | undefined;
  descriptor: { label: string; fmt: (v: number) => string };
  noun: string;
  /** Substantivo masculino ("ritmo"): "Seu ritmo médio". */
  masculine?: boolean;
  /** Sem genero fixo ("o tempo dentro da faixa..."): usa a frase por treino com este sujeito no lugar de "sua/seu {noun} média". */
  subject?: string;
  /** Id do texto "O que isso representa" (indicatorMeanings.ts). */
  meaningId?: string;
  emptyText: string;
  caution?: string;
  unit: string;
  formatY: (v: number) => string;
  // Pace: o MAIS RAPIDO (menor s/km) fica no alto — mesma convencao do Treino completo. So' representacao.
  higherIsUp: boolean;
}) {
  const points = useMemo(() => (snapshot ? observationPoints(snapshot) : []), [snapshot]);
  const mm = useMemo(() => (snapshot ? movingAveragePoints(snapshot, 'short_21d') : []), [snapshot]);
  const hasReading = useIndicatorReading(meaningId) != null;
  if (!snapshot || snapshot.evidence.n === 0) {
    return <Card title={title}><Text style={styles.muted}>{emptyText}</Text></Card>;
  }
  // 02/11/2026: faixa habitual vinda do servidor (mesma matematica do painel e do texto), no lugar do canal calculado no celular.
  const channelPoints = referenceChannelPoints(snapshot);
  const lead = subject ? sessionMeanSentences(snapshot, { subject, fmt: descriptor.fmt }) : recentVsLastSentences(snapshot, { noun, fmt: descriptor.fmt, masculine });
  const sentences = [...lead, ...describeVariable(snapshot, descriptor)];
  return (
    <Card title={title}>
      <Text style={styles.tag}>Modalidade: corrida</Text>
      {snapshot.provisional ? <Text style={styles.caution}>Este dado está sendo atualizado depois de uma correção de atividade e pode mudar.</Text> : null}
      {points.length >= 2 ? (
        <DetailChart
          title=""
          unit={unit}
          points={points}
          xLabel="data"
          formatX={formatDayLabel}
          formatY={formatY}
          higherIsUp={higherIsUp}
          secondary={mm.length > 1 ? { label: 'média das últimas 3 semanas', points: mm } : undefined}
          channel={channelPoints.length > 1 ? { points: channelPoints, label: 'sua faixa habitual (onde seus treinos costumam ficar)', showMean: false } : undefined}
          seriesLabel="cada treino"
        />
      ) : (
        <Text style={styles.muted}>É preciso ao menos 2 treinos com este dado para desenhar a evolução.</Text>
      )}
      <Sentences items={sentences} />
      <IndicatorMeaning id={meaningId} />
    </Card>
  );
}

// Indicador SEMANAL (uma bolinha por semana COMPLETA, segunda a domingo). A semana em andamento fica fora do grafico e do texto ate terminar; faixa e media movel
// vem do servidor (mesmos pontos, so' filtrados para as semanas completas).
export function WeeklyCard({
  title,
  snapshot: allSnapshot,
  descriptor,
  unit,
  formatY,
  emptyText,
  caution,
  meaningId,
  variableId,
  accessToken,
  higherIsUp = true,
}: {
  title: string;
  snapshot: SnapshotLite | null | undefined;
  descriptor: WeeklyDescriptor;
  unit: string;
  formatY: (v: number) => string;
  emptyText: string;
  caution?: string;
  meaningId?: string;
  /** Com `variableId` e `accessToken`, o cartao oferece o seletor de modalidade (Todas por padrao) a partir de `availableModalities`; a escolha busca a MESMA leitura do servidor filtrada. */
  variableId?: string;
  accessToken?: string;
  /** Ritmo: o mais rapido (menor s/km) fica no alto. So' representacao. */
  higherIsUp?: boolean;
}) {
  const hasReading = useIndicatorReading(meaningId) != null;
  const [modality, setModality] = useState<string | null>(null);
  const [filtered, setFiltered] = useState<SnapshotLite | null | undefined>(undefined);
  useEffect(() => {
    if (!modality || !variableId || !accessToken) { setFiltered(undefined); return undefined; }
    let alive = true;
    setFiltered(undefined);
    fetchSnapshot(variableId, accessToken, { reference: true, modality }).then((s) => { if (alive) setFiltered(s); });
    return () => { alive = false; };
  }, [modality, variableId, accessToken]);
  const modalities = variableId && accessToken ? allSnapshot?.availableModalities ?? [] : [];
  const snapshot = modality ? filtered : allSnapshot;
  const chips = modalities.length >= 2 ? (
    <View style={styles.chips}>
      {[null, ...modalities].map((m) => (
        <Pressable key={m ?? 'todas'} onPress={() => setModality(m)} style={[styles.chip, modality === m && styles.chipActive]}>
          <Text style={[styles.chipText, modality === m && styles.chipTextActive]}>{m ? modalityName(m) : 'Todas'}</Text>
        </Pressable>
      ))}
    </View>
  ) : null;
  const points = useMemo(() => completeWeekPoints(snapshot).map((p) => ({ x: dayFromIso(p.timestamp), y: p.value })), [snapshot]);
  const mm = useMemo(() => {
    const xs = new Set(points.map((p) => p.x));
    return snapshot ? movingAveragePoints(snapshot, 'short_21d').filter((p) => xs.has(p.x)) : [];
  }, [snapshot, points]);
  const channelPoints = useMemo(() => {
    const xs = new Set(points.map((p) => p.x));
    return referenceChannelPoints(snapshot).filter((p) => xs.has(p.x));
  }, [snapshot, points]);

  if (modality && snapshot === undefined) {
    return <Card title={title}>{chips}<ActivityIndicator size="small" /></Card>;
  }
  if (!snapshot || snapshot.evidence.n === 0) {
    return <Card title={title}>{chips}<Text style={styles.muted}>{modality ? `Sem registros de ${modalityName(modality)} ainda.` : emptyText}</Text></Card>;
  }
  return (
    <Card title={title}>
      {chips}
      <Text style={styles.tag}>Uma bolinha por semana completa</Text>
      {points.length >= 2 ? (
        <DetailChart
          title=""
          unit={unit}
          points={points}
          xLabel="semana"
          formatX={formatDayLabel}
          formatY={formatY}
          higherIsUp={higherIsUp}
          secondary={mm.length > 1 ? { label: 'média das últimas 3 semanas', points: mm } : undefined}
          channel={channelPoints.length > 1 ? { points: channelPoints, label: 'sua faixa habitual (onde suas semanas costumam ficar)', showMean: false } : undefined}
          seriesLabel="cada semana"
        />
      ) : (
        <Text style={styles.muted}>É preciso ao menos 2 semanas completas com este dado para desenhar a evolução.</Text>
      )}
      <Sentences items={[...weeklySentences(snapshot, descriptor), ...(acuteChronicSentence(snapshot, descriptor.fmt) ? [acuteChronicSentence(snapshot, descriptor.fmt) as string] : [])]} />
      <IndicatorMeaning id={meaningId} />
    </Card>
  );
}

export function EvolutionObjectiveSections({ accessToken, weeks, todayIso }: { accessToken: string; weeks: WeekVolumeLite[]; todayIso: string }) {
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotLite | null> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSnapshots([...IDS], accessToken, { reference: true }).then((map) => { if (alive) setSnapshots(map); });
    return () => { alive = false; };
  }, [accessToken]);

  if (!snapshots) return <ActivityIndicator size="small" style={{ marginVertical: 12 }} />;
  const volumeLines = volumeSentences(weeks, todayIso, snapshots['training.volumeCompletedTotalKm']);

  return (
    <View style={{ gap: 16, marginBottom: 16 }}>
      {volumeLines.length > 0 ? (
        <Card title="O que os números de volume mostram">
          <Sentences items={volumeLines} />
        </Card>
      ) : null}
      <WeeklyCard
        title="Diferença: realizado − prescrito"
        meaningId="training.volumeDiffAbsoluteKm"
        snapshot={snapshots['training.volumeDiffAbsoluteKm']}
        descriptor={DIFF}
        unit="km por semana (0 = igual ao prescrito)"
        formatY={(v) => String(Math.round(v * 10) / 10).replace('.', ',')}
        emptyText="Ainda não há semanas com volume prescrito e realizado para comparar."
        caution="Cada ponto é uma semana completa, de segunda a domingo. Descrição dos seus registros; não indica o que é certo ou errado."
      />
      <WeeklyCard
        title="Razão: realizado ÷ prescrito"
        meaningId="training.volumeRatioCompletedPrescribed"
        snapshot={snapshots['training.volumeRatioCompletedPrescribed']}
        descriptor={RATIO}
        unit="razão (1 = igual ao prescrito)"
        formatY={(v) => (Math.round(v * 10) / 10).toFixed(1).replace('.', ',')}
        emptyText="Ainda não há semanas com volume prescrito para calcular a razão."
        caution="O realizado inclui os treinos extras. Semana sem volume prescrito não entra. Descrição dos seus registros; não indica o que é certo ou errado."
      />
      <MetricCard
        title="Cadência ao longo do tempo"
        meaningId="activity.cadenceAvg"
        snapshot={snapshots['activity.cadenceAvg']}
        descriptor={CADENCE}
        noun="cadência"
        unit="passos por minuto"
        formatY={(v) => String(Math.round(v))}
        higherIsUp
        emptyText="Ainda não há corridas com cadência fornecida pelo seu dispositivo."
      />
      <WeeklyCard
        title="Ritmo médio por semana"
        meaningId="activity.weeklyAvgPaceSecondsKm"
        snapshot={snapshots['activity.weeklyAvgPaceSecondsKm']}
        descriptor={WEEKLY_PACE}
        unit="min/km (mais rápido no alto)"
        formatY={(v) => formatPaceSeconds(v).replace('/km', '')}
        higherIsUp={false}
        emptyText="Ainda não há semanas completas com corridas de distância e duração registradas pelo relógio."
        caution="Tempo total ÷ distância total das corridas da semana: uma corrida longa pesa mais que um tiro curto. Mistura treinos leves, longões e intervalados; semana sem corrida registrada fica sem ponto. Descrição dos seus registros; não é uma nota."
      />
      <MetricCard
        title="Ritmo ao longo do tempo"
        meaningId="activity.avgPaceSecondsKm"
        snapshot={snapshots['activity.avgPaceSecondsKm']}
        descriptor={PACE}
        noun="ritmo"
        masculine
        unit="min/km (mais rápido no alto)"
        formatY={(v) => formatPaceSeconds(v).replace('/km', '')}
        higherIsUp={false}
        emptyText="Ainda não há corridas com distância e duração registradas pelo relógio."
        caution="Cada ponto é o ritmo médio de uma corrida; treinos leves, longões e intervalados têm intenções diferentes e aparecem juntos."
      />
      <MetricCard
        title="Tempo dentro da faixa de ritmo prescrita"
        meaningId="execution.timeInBandPct"
        snapshot={snapshots['execution.timeInBandPct']}
        descriptor={TIME_IN_BAND}
        noun="tempo dentro da faixa"
        subject="o tempo dentro da faixa de ritmo prescrita"
        unit="% do tempo observável do treino"
        formatY={(v) => String(Math.round(v))}
        higherIsUp
        emptyText="Ainda não há corridas com faixa de ritmo prescrita e dados do relógio suficientes."
        caution="Mostra a parte do tempo observável do treino em que seu ritmo ficou dentro da faixa prescrita. Só entram corridas com faixa de ritmo prescrita e dados do relógio. Descrição dos seus registros; não é uma nota."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  sentence: { fontSize: 13, color: '#334155', lineHeight: 19 },
  muted: { fontSize: 12, color: '#64748b' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: '#f1f5f9' },
  chipActive: { backgroundColor: '#1769AA' },
  chipText: { fontSize: 11, fontWeight: '600', color: '#475569' },
  chipTextActive: { color: '#fff' },
  tag: { alignSelf: 'flex-start', fontSize: 11, color: '#475569', backgroundColor: '#f1f5f9', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  caution: { fontSize: 11, color: '#94a3b8' },
});
