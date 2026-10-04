import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { DetailChart } from '../src/activityDetail';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchSnapshots } from './homeApi';
import { FEELING_DOMAINS, FeelingDomain, SnapshotLite, DomainVariable, domainSentences, habitualBand, shiftLabel } from './insights';
import { formatDayLabel, formatDayLong, movingAveragePoints, observationPoints } from './chartData';

// Telas de detalhe de "Como voce esta" (04/10/2026): Sono, Prontidao pre-treino, Percepcao de
// esforco e Resposta pos-treino. Consumo PURO de GET /me/observations/:variableId (mesmo motor
// longitudinal que a Home e o painel do treinador usam) — nenhuma matematica refeita aqui. Cada
// variavel mantem sua escala original (1-5 ou RPE 1-10, eixo fixo no dominio da escala, nunca
// reescalado) e sua direcao semantica (5 = MAIS do construto, nunca "melhor"). Variaveis de
// significados diferentes nunca sao fundidas num mesmo grafico.

function fmtValue(v: number, variable: DomainVariable) {
  const rounded = Math.round(v * 10) / 10;
  return `${String(rounded).replace('.', ',')}${variable.unit ? ` ${variable.unit}` : ''}`;
}

function VariableBlock({ variable, snapshot }: { variable: DomainVariable; snapshot: SnapshotLite | null | undefined }) {
  const points = useMemo(() => (snapshot && !variable.categorical ? observationPoints(snapshot) : []), [snapshot, variable]);
  const mm = useMemo(() => (snapshot && !variable.categorical ? movingAveragePoints(snapshot, 'short_21d') : []), [snapshot, variable]);

  if (!snapshot || snapshot.evidence.n === 0) {
    return (
      <View style={[styles.block, HomeBorder.card]}>
        <Text style={styles.blockTitle}>{variable.label}</Text>
        <Text style={styles.empty}>Sem registros ainda.</Text>
      </View>
    );
  }

  if (variable.categorical) {
    const last = snapshot.observations.filter((o) => typeof o.value === 'string').slice(-7).reverse();
    return (
      <View style={[styles.block, HomeBorder.card]}>
        <Text style={styles.blockTitle}>{variable.label}</Text>
        {last.length === 0 ? <Text style={styles.empty}>Sem registros ainda.</Text> : last.map((o) => (
          <View key={o.timestamp} style={styles.categoricalRow}>
            <Text style={styles.categoricalDate}>{formatDayLong(new Date(o.timestamp).getTime() / 86400000)}</Text>
            <Text style={styles.categoricalValue}>{shiftLabel(String(o.value))}</Text>
          </View>
        ))}
        <Text style={styles.hint}>Registro por treino; sem cálculo de tendência para categorias.</Text>
      </View>
    );
  }

  const scale = snapshot.variable.scale;
  const fixedDomain = snapshot.variable.dataType === 'ordinal_scale' && scale ? { min: scale.min, max: scale.max } : undefined;
  const showBand = habitualBand(snapshot);

  return (
    <View style={[styles.block, HomeBorder.card]}>
      <Text style={styles.blockTitle}>{variable.label}</Text>
      <Text style={styles.blockValue}>
        Último: {snapshot.current != null ? fmtValue(snapshot.current, variable) : '—'}
        {scale && snapshot.variable.dataType === 'ordinal_scale' ? ` / ${scale.max}` : ''}
        <Text style={styles.blockN}>  ·  {snapshot.evidence.n} registro{snapshot.evidence.n === 1 ? '' : 's'}</Text>
      </Text>
      {variable.scaleHint ? <Text style={styles.hint}>{variable.scaleHint}</Text> : null}
      {points.length >= 2 ? (
        <DetailChart
          title=""
          unit={variable.unit ?? (scale?.unit ?? 'pontos da escala')}
          points={points}
          xLabel="data"
          formatX={formatDayLabel}
          formatY={(v) => String(Math.round(v * 10) / 10).replace('.', ',')}
          higherIsUp
          yDomain={fixedDomain}
          secondary={mm.length > 1 ? { label: 'média das últimas 3 semanas', points: mm } : undefined}
          band={showBand}
          seriesLabel="seus registros"
        />
      ) : (
        <Text style={styles.empty}>É preciso ao menos 2 registros para desenhar a evolução.</Text>
      )}
    </View>
  );
}

export function FeelingsDetailScreen({ accessToken, domain, onBack }: { accessToken: string; domain: FeelingDomain; onBack: () => void }) {
  const cfg = FEELING_DOMAINS[domain];
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotLite | null> | null>(null);

  useEffect(() => {
    let alive = true;
    setSnapshots(null);
    fetchSnapshots(cfg.variables.map((v) => v.id), accessToken).then((map) => { if (alive) setSnapshots(map); });
    return () => { alive = false; };
  }, [accessToken, domain]);

  const sentences = useMemo(() => (snapshots ? domainSentences(domain, snapshots) : []), [snapshots, domain]);
  const anyData = snapshots ? cfg.variables.some((v) => (snapshots[v.id]?.evidence.n ?? 0) > 0) : false;

  return (
    <View style={styles.container}>
      <Pressable onPress={onBack} style={styles.back}>
        <Ionicons name="chevron-back" size={16} color={HomeColors.panzeriInteraction} />
        <Text style={styles.backText}>Início</Text>
      </Pressable>
      <Text style={styles.title}>{cfg.title}</Text>
      <Text style={styles.subtitle}>{cfg.subtitle}</Text>

      {!snapshots ? (
        <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />
      ) : !anyData ? (
        <Text style={styles.empty}>Conforme você responde aos feedbacks dos treinos, esta área mostra sua evolução ao longo do tempo.</Text>
      ) : (
        <>
          <View style={[styles.textCard]}>
            <Text style={styles.textCardTitle}>O que seus registros mostram</Text>
            {sentences.length > 0 ? <Text style={styles.sentence}>{sentences.join(' ')}</Text> : (
              <Text style={styles.sentence}>Ainda não há registros suficientes para interpretar.</Text>
            )}
            <Text style={styles.disclaimer}>Descrição dos seus próprios registros, sem diagnóstico e sem relação de causa.</Text>
          </View>
          {cfg.variables.map((v) => <VariableBlock key={v.id} variable={v} snapshot={snapshots[v.id]} />)}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.component },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: HomeSpace.small },
  backText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },
  title: { ...HomeTypography.greeting, color: HomeColors.textPrimary },
  subtitle: { ...HomeTypography.body, color: HomeColors.textSecondary, marginTop: -8 },
  block: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 6 },
  blockTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  blockValue: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  blockN: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },
  hint: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },
  empty: { ...HomeTypography.body, color: HomeColors.textSecondary },
  categoricalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: HomeColors.divider },
  categoricalDate: { ...HomeTypography.body, color: HomeColors.textSecondary },
  categoricalValue: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  textCard: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 6 },
  textCardTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  sentence: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  disclaimer: { ...HomeTypography.tertiary, color: HomeColors.textTertiary, marginTop: 4 },
});
