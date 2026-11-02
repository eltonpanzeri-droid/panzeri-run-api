import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { DetailChart } from '../src/activityDetail';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth, fetchSnapshots } from './homeApi';
import { DomainVariable, LoadWeekLite, LoadWindowLite, SnapshotLite, WeeklyDescriptor, loadChartWeeks, loadWeekSentences, loadWindowSentences } from './insights';
import { dayFromIso, formatDayLabel } from './chartData';
import { VariableBlock } from './FeelingsDetailScreen';
import { WeeklyCard } from './EvolutionObjective';

// "Resposta a carga" da Evolucao (02/11/2026, lote 5): carga interna percebida (esforco x minutos) e relacoes aguda x cronica, tudo vindo do servidor — a mesma conta do painel do
// treinador (GET /me/training-load) e da camada longitudinal. Nenhuma conta nova aqui; descricao, sem faixa de risco e sem diagnostico.

type ViewKey = 'geral' | 'corrida' | 'forca' | 'outras';
const VIEW_LABEL: Record<ViewKey, string> = { geral: 'Todas', corrida: 'Corrida', forca: 'Força', outras: 'Outras' };
const VIEW_ORDER: ViewKey[] = ['geral', 'corrida', 'forca', 'outras'];

interface LoadView { weeks: LoadWeekLite[]; current: LoadWindowLite; totals: { sessions: number; excluded: number; load: number } }
interface TrainingLoadLite { views: Record<ViewKey, LoadView>; method: { generalViewNote: string } }

const SESSION_LOAD: DomainVariable = { id: 'workout.sessionInternalLoad', label: 'Carga de cada treino (esforço × minutos)', unit: 'UA', scaleHint: 'Esforço percebido (1 a 10) × minutos de treino, em UA (unidade arbitrária)' };
const HEART_RATE: DomainVariable = { id: 'activity.avgHeartRateBpm', label: 'Frequência cardíaca média de cada atividade', unit: 'bpm', scaleHint: 'Média informada pelo seu relógio em cada atividade que tem frequência cardíaca.' };
const WEEK_DEMAND: DomainVariable = { id: 'checkin.weekDemandVsNormal', label: 'Exigência da semana comparada ao seu normal', scaleHint: '1 = muito menos exigente · 3 = dentro do normal · 5 = muito mais exigente' };

const ratio2 = (v: number) => v.toFixed(2).replace('.', ',');
const ACWR: WeeklyDescriptor = {
  fmt: ratio2,
  lastLine: (v) => `a relação entre o volume dos últimos 28 dias e o dos últimos 42 dias foi de ${ratio2(v)}`,
};

function Sentences({ items }: { items: string[] }) {
  return <View style={{ gap: 4 }}>{items.map((s) => <Text key={s} style={styles.sentence}>• {s}</Text>)}</View>;
}

export function LoadSection({ accessToken }: { accessToken: string }) {
  const [load, setLoad] = useState<TrainingLoadLite | null | undefined>(undefined);
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotLite | null> | null>(null);
  const [view, setView] = useState<ViewKey>('geral');

  useEffect(() => {
    let alive = true;
    fetchJsonAuth<TrainingLoadLite>('/me/training-load', accessToken).then((d) => { if (alive) setLoad(d); });
    fetchSnapshots([SESSION_LOAD.id, 'training.acwr', HEART_RATE.id, WEEK_DEMAND.id], accessToken, { reference: true }).then((m) => { if (alive) setSnapshots(m); });
    return () => { alive = false; };
  }, [accessToken]);

  const current = load?.views?.[view];
  const chartPoints = useMemo(() => loadChartWeeks(current?.weeks ?? []).map((w) => ({ x: dayFromIso(`${w.weekStart}T12:00:00.000Z`), y: w.load })), [current]);
  const available = VIEW_ORDER.filter((key) => key === 'geral' || (load?.views?.[key]?.totals.sessions ?? 0) > 0);

  if (load === undefined || snapshots === null) return <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Carga de treino</Text>
      <Text style={styles.subtitle}>Esforço percebido (1 a 10) × minutos de cada treino, em UA (unidade arbitrária).</Text>

      <VariableBlock variable={SESSION_LOAD} snapshot={snapshots[SESSION_LOAD.id]} accessToken={accessToken} />

      {load && current ? (
        <View style={[styles.block, HomeBorder.card]}>
          <Text style={styles.blockTitle}>Carga acumulada por semana</Text>
          {available.length >= 2 ? (
            <View style={styles.chips}>
              {available.map((key) => (
                <Pressable key={key} onPress={() => setView(key)} style={[styles.chip, view === key && styles.chipActive]}>
                  <Text style={[styles.chipText, view === key && styles.chipTextActive]}>{VIEW_LABEL[key]}</Text>
                </Pressable>
              ))}
            </View>
          ) : null}
          {chartPoints.filter((p) => p.y != null).length >= 2 ? (
            <DetailChart
              title=""
              unit="UA por semana"
              points={chartPoints}
              xLabel="semana"
              formatX={formatDayLabel}
              formatY={(v) => String(Math.round(v))}
              higherIsUp
              seriesLabel="cada semana completa"
            />
          ) : (
            <Text style={styles.empty}>É preciso ao menos 2 semanas completas com carga registrada para desenhar a evolução.</Text>
          )}
          <Sentences items={loadWeekSentences(current.weeks)} />
          {view === 'geral' && load.method?.generalViewNote ? <Text style={styles.hint}>{load.method.generalViewNote}</Text> : null}
          <Text style={styles.hint}>Semana sem nenhum treino com esforço e duração registrados fica sem ponto (não é contada como zero).</Text>
        </View>
      ) : null}

      {load && current ? (
        <View style={[styles.block, HomeBorder.card]}>
          <Text style={styles.blockTitle}>Carga recente × seu hábito</Text>
          <Sentences items={loadWindowSentences(current.current)} />
          <Text style={styles.hint}>Razão 1,0 = mesma carga do seu hábito recente; acima = semana mais carregada que o hábito; abaixo = mais leve. É uma descrição, sem faixa de risco.</Text>
        </View>
      ) : (
        <Text style={styles.empty}>Não foi possível carregar a carga agora. Tente novamente em instantes.</Text>
      )}

      <WeeklyCard
        title="Volume: relação aguda ÷ crônica (km)"
        snapshot={snapshots['training.acwr']}
        descriptor={ACWR}
        unit="razão (28 dias ÷ 42 dias)"
        formatY={ratio2}
        emptyText="Ainda não há histórico de volume suficiente para esta relação."
        caution="Razão de volume em km (média de 28 dias ÷ média de 42 dias); não é a razão da carga de esforço acima. Descrição dos seus registros; não indica risco."
      />

      <VariableBlock variable={HEART_RATE} snapshot={snapshots[HEART_RATE.id]} accessToken={accessToken} />

      <VariableBlock variable={WEEK_DEMAND} snapshot={snapshots[WEEK_DEMAND.id]} accessToken={accessToken} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.related },
  title: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  subtitle: { ...HomeTypography.body, color: HomeColors.textSecondary },
  block: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 8 },
  blockTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  sentence: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  hint: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },
  empty: { ...HomeTypography.body, color: HomeColors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: HomeColors.surfaceHighlight },
  chipActive: { backgroundColor: HomeColors.panzeriInteraction },
  chipText: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  chipTextActive: { color: '#fff' },
});
