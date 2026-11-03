import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth, fetchSnapshots } from './homeApi';
import { DomainVariable, LoadWindowLite, SnapshotLite, WeeklyDescriptor, loadWindowSentences } from './insights';
import { VariableBlock } from './FeelingsDetailScreen';
import { WeeklyCard } from './EvolutionObjective';
import { IndicatorMeaning } from './IndicatorMeaning';
import { HrDecouplingSection } from './HrDecouplingSection';

// "Resposta a carga" da Evolucao (02/11/2026, lotes 5 e 6): carga interna percebida (esforco x minutos) e relacoes aguda x cronica. Tudo vem do servidor: a carga por treino e a SEMANAL
// (faixa e media movel da camada longitudinal, com seletor de modalidade) e, para a janela de 7 e 28 dias, a mesma conta do painel do treinador (GET /me/training-load).
// Nenhuma conta nova aqui; descricao, sem faixa de risco e sem diagnostico.

interface TrainingLoadLite { views: { geral: { current: LoadWindowLite } }; method: { generalViewNote: string } }

const SESSION_LOAD: DomainVariable = { id: 'workout.sessionInternalLoad', label: 'Carga de cada treino (esforço × minutos)', unit: 'UA', scaleHint: 'Esforço percebido (1 a 10) × minutos de treino, em UA (unidade arbitrária)' };
const WEEKLY_LOAD_ID = 'workout.weeklyInternalLoad';
const HEART_RATE: DomainVariable = { id: 'activity.avgHeartRateBpm', label: 'Frequência cardíaca média de cada atividade', unit: 'bpm', scaleHint: 'Média informada pelo seu relógio em cada atividade que tem frequência cardíaca.' };
const WEEK_DEMAND: DomainVariable = { id: 'checkin.weekDemandVsNormal', label: 'Exigência da semana comparada ao seu normal', scaleHint: '1 = muito menos exigente · 3 = dentro do normal · 5 = muito mais exigente' };

const ratio2 = (v: number) => v.toFixed(2).replace('.', ',');
const uaText = (v: number) => `${String(Math.round(v * 10) / 10).replace('.', ',')} UA`;
const ACWR: WeeklyDescriptor = {
  fmt: ratio2,
  lastLine: (v) => `a relação entre o volume dos últimos 28 dias e o dos últimos 42 dias foi de ${ratio2(v)}`,
};
const WEEKLY_LOAD: WeeklyDescriptor = {
  fmt: uaText,
  lastLine: (v, c) => `a carga foi de ${uaText(v)}${c?.numerator != null ? `, em ${c.numerator} ${c.numerator === 1 ? 'treino' : 'treinos'}` : ''}`,
};

function Sentences({ items }: { items: string[] }) {
  return <View style={{ gap: 4 }}>{items.map((s) => <Text key={s} style={styles.sentence}>• {s}</Text>)}</View>;
}

export function LoadSection({ accessToken }: { accessToken: string }) {
  const [load, setLoad] = useState<TrainingLoadLite | null | undefined>(undefined);
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotLite | null> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchJsonAuth<TrainingLoadLite>('/me/training-load', accessToken).then((d) => { if (alive) setLoad(d); });
    fetchSnapshots([SESSION_LOAD.id, WEEKLY_LOAD_ID, 'training.acwr', HEART_RATE.id, WEEK_DEMAND.id], accessToken, { reference: true }).then((m) => { if (alive) setSnapshots(m); });
    return () => { alive = false; };
  }, [accessToken]);

  if (load === undefined || snapshots === null) return <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />;
  const window = load?.views?.geral?.current;

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Carga de treino</Text>
      <Text style={styles.subtitle}>Esforço percebido (1 a 10) × minutos de cada treino, em UA (unidade arbitrária).</Text>

      <VariableBlock variable={SESSION_LOAD} snapshot={snapshots[SESSION_LOAD.id]} accessToken={accessToken} />

      <WeeklyCard
        title="Carga acumulada por semana"
        meaningId="load.weekly"
        snapshot={snapshots[WEEKLY_LOAD_ID]}
        variableId={WEEKLY_LOAD_ID}
        accessToken={accessToken}
        descriptor={WEEKLY_LOAD}
        unit="UA por semana"
        formatY={(v) => String(Math.round(v))}
        emptyText="Ainda não há semanas completas com carga registrada (esforço percebido e duração)."
        caution={'Soma das cargas dos treinos da semana. Semana sem nenhum treino com esforço e duração registrados fica sem ponto (não é contada como zero). Em "Todas", somam-se esforços de modalidades diferentes; use os botões para comparar cada uma.'}
      />

      {window ? (
        <View style={[styles.block, HomeBorder.card]}>
          <Text style={styles.blockTitle}>Carga recente × seu hábito</Text>
          <Sentences items={loadWindowSentences(window)} />
          <Text style={styles.hint}>Razão 1,0 = mesma carga do seu hábito recente; acima = semana mais carregada que o hábito; abaixo = mais leve. É uma descrição, sem faixa de risco.</Text>
          {load?.method?.generalViewNote ? <Text style={styles.hint}>{load.method.generalViewNote}</Text> : null}
          <IndicatorMeaning id="load.acuteChronic" />
        </View>
      ) : (
        <Text style={styles.empty}>Não foi possível carregar a carga agora. Tente novamente em instantes.</Text>
      )}

      <WeeklyCard
        title="Volume: relação aguda ÷ crônica (km)"
        meaningId="training.acwr"
        snapshot={snapshots['training.acwr']}
        descriptor={ACWR}
        unit="razão (28 dias ÷ 42 dias)"
        formatY={ratio2}
        emptyText="Ainda não há histórico de volume suficiente para esta relação."
        caution="Razão de volume em km (média de 28 dias ÷ média de 42 dias); não é a razão da carga de esforço acima. Descrição dos seus registros; não indica risco."
      />

      <VariableBlock variable={HEART_RATE} snapshot={snapshots[HEART_RATE.id]} accessToken={accessToken} />

      <VariableBlock variable={WEEK_DEMAND} snapshot={snapshots[WEEK_DEMAND.id]} accessToken={accessToken} />

      <HrDecouplingSection accessToken={accessToken} />
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
});
