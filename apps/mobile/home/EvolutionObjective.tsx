import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { DetailChart } from '../src/activityDetail';
import { fetchSnapshots } from './homeApi';
import {
  SnapshotLite,
  WeekVolumeLite,
  describeVariable,
  formatPaceSeconds,
  recentVsLastSentences,
  volumeSentences,
} from './insights';
import { formatDayLabel, movingAveragePoints, observationPoints } from './chartData';

// Secoes da tela "Evolucao objetiva do treinamento" (04/10/2026) que se somam ao volume
// prescrito/realizado/extra ja' existente em Progress (App.tsx): interpretacao em texto do volume,
// pace e cadencia. Tudo vem do motor longitudinal (variaveis training.* e activity.*) — nada e'
// recalculado aqui. Pace e cadencia sao OBJETIVOS (ActivityLog); sem dado valido, a secao diz isso
// em vez de mostrar grafico vazio ou zero.

const IDS = ['training.volumeCompletedTotalKm', 'activity.avgPaceSecondsKm', 'activity.cadenceAvg'] as const;

const PACE = { label: 'Ritmo médio', fmt: (v: number) => formatPaceSeconds(v) };
const CADENCE = { label: 'Cadência média', fmt: (v: number) => `${Math.round(v)} spm` };

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
}: {
  title: string;
  snapshot: SnapshotLite | null | undefined;
  descriptor: { label: string; fmt: (v: number) => string };
  noun: string;
  emptyText: string;
  caution?: string;
  unit: string;
  formatY: (v: number) => string;
}) {
  const points = useMemo(() => (snapshot ? observationPoints(snapshot) : []), [snapshot]);
  const mm = useMemo(() => (snapshot ? movingAveragePoints(snapshot, 'short_21d') : []), [snapshot]);
  if (!snapshot || snapshot.evidence.n === 0) {
    return <Card title={title}><Text style={styles.muted}>{emptyText}</Text></Card>;
  }
  const range = snapshot.habitualRange;
  const band = range && range.lower != null && range.upper != null && range.n >= 5 ? { lower: range.lower, upper: range.upper, label: 'faixa habitual' } : undefined;
  const sentences = [...recentVsLastSentences(snapshot, { noun, fmt: descriptor.fmt }), ...describeVariable(snapshot, descriptor)];
  return (
    <Card title={title}>
      {points.length >= 2 ? (
        <DetailChart
          title=""
          unit={unit}
          points={points}
          xLabel="data"
          formatX={formatDayLabel}
          formatY={formatY}
          higherIsUp
          secondary={mm.length > 1 ? { label: 'média das últimas 3 semanas', points: mm } : undefined}
          band={band}
          seriesLabel="cada treino"
        />
      ) : (
        <Text style={styles.muted}>É preciso ao menos 2 treinos com este dado para desenhar a evolução.</Text>
      )}
      <Sentences items={sentences} />
      {caution ? <Text style={styles.caution}>{caution}</Text> : null}
    </Card>
  );
}

export function EvolutionObjectiveSections({ accessToken, weeks, todayIso }: { accessToken: string; weeks: WeekVolumeLite[]; todayIso: string }) {
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotLite | null> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSnapshots([...IDS], accessToken).then((map) => { if (alive) setSnapshots(map); });
    return () => { alive = false; };
  }, [accessToken]);

  if (!snapshots) return <ActivityIndicator size="small" style={{ marginVertical: 12 }} />;
  const volumeLines = volumeSentences(weeks, todayIso, snapshots['training.volumeCompletedTotalKm']);

  return (
    <View style={{ gap: 16, marginBottom: 16 }}>
      {volumeLines.length > 0 ? (
        <Card title="O que os números de volume mostram">
          <Sentences items={volumeLines} />
          <Text style={styles.caution}>Descrição dos seus próprios registros; não indica o que é certo ou errado.</Text>
        </Card>
      ) : null}
      <MetricCard
        title="Ritmo ao longo do tempo"
        snapshot={snapshots['activity.avgPaceSecondsKm']}
        descriptor={PACE}
        noun="ritmo"
        unit="min/km (maior valor = mais lento)"
        formatY={(v) => formatPaceSeconds(v).replace('/km', '')}
        emptyText="Ainda não há corridas com distância e duração registradas pelo relógio."
        caution="Cada ponto é o ritmo médio de uma corrida; treinos leves, longões e intervalados têm intenções diferentes e aparecem juntos."
      />
      <MetricCard
        title="Cadência ao longo do tempo"
        snapshot={snapshots['activity.cadenceAvg']}
        descriptor={CADENCE}
        noun="cadência"
        unit="passos por minuto"
        formatY={(v) => String(Math.round(v))}
        emptyText="Ainda não há corridas com cadência fornecida pelo seu dispositivo."
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { backgroundColor: '#fff', borderRadius: 12, padding: 12, borderWidth: 1, borderColor: '#e2e8f0', gap: 8 },
  cardTitle: { fontSize: 13, fontWeight: '700', color: '#1e293b' },
  sentence: { fontSize: 13, color: '#334155', lineHeight: 19 },
  muted: { fontSize: 12, color: '#64748b' },
  caution: { fontSize: 11, color: '#94a3b8' },
});
