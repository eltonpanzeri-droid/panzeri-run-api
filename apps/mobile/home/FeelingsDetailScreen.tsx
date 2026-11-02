import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { Ionicons } from '@expo/vector-icons';
import { DetailChart } from '../src/activityDetail';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchSnapshot, fetchSnapshots } from './homeApi';
import { FEELING_DOMAINS, FeelingDomain, SnapshotLite, DomainVariable, domainSentences, shiftLabel } from './insights';
import { SourcesLink } from '../src/scientificSources/ScientificSourcesScreen';
import { formatDayLabel, formatDayLong, modalityName, movingAveragePoints, observationPoints, referenceChannelPoints } from './chartData';

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

function VariableBlock({ variable, snapshot: allSnapshot, accessToken }: { variable: DomainVariable; snapshot: SnapshotLite | null | undefined; accessToken: string }) {
  // 02/11/2026: seletor de modalidade DENTRO do grafico (padrao: todas). So' aparece quando a variavel tem dado em 2+ modalidades; a escolha busca a MESMA leitura
  // do servidor filtrada pela modalidade (nenhuma conta no app).
  const [modality, setModality] = useState<string | null>(null);
  const [filtered, setFiltered] = useState<SnapshotLite | null | undefined>(undefined);
  useEffect(() => {
    if (!modality) { setFiltered(undefined); return undefined; }
    let alive = true;
    setFiltered(undefined);
    fetchSnapshot(variable.id, accessToken, { reference: true, modality }).then((s) => { if (alive) setFiltered(s); });
    return () => { alive = false; };
  }, [modality, variable.id, accessToken]);
  const modalities = allSnapshot?.availableModalities ?? [];
  const snapshot = modality ? filtered : allSnapshot;
  const points = useMemo(() => (snapshot && !variable.categorical ? observationPoints(snapshot) : []), [snapshot, variable]);
  const mm = useMemo(() => (snapshot && !variable.categorical ? movingAveragePoints(snapshot, 'short_21d') : []), [snapshot, variable]);
  const channelPoints = useMemo(() => referenceChannelPoints(snapshot), [snapshot]);

  // Os botoes ficam em todos os estados (carregando/sem registro na modalidade) para a aluna sempre poder voltar a "Todas".
  const chips = modalities.length >= 2 && !variable.categorical ? (
    <View style={styles.chips}>
      {[null, ...modalities].map((m) => (
        <Pressable key={m ?? 'todas'} onPress={() => setModality(m)} style={[styles.chip, modality === m && styles.chipActive]}>
          <Text style={[styles.chipText, modality === m && styles.chipTextActive]}>{m ? modalityName(m) : 'Todas'}</Text>
        </Pressable>
      ))}
    </View>
  ) : null;

  if (modality && snapshot === undefined) {
    return (
      <View style={[styles.block, HomeBorder.card]}>
        <Text style={styles.blockTitle}>{variable.label}</Text>
        {chips}
        <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} />
      </View>
    );
  }

  if (!snapshot || snapshot.evidence.n === 0) {
    return (
      <View style={[styles.block, HomeBorder.card]}>
        <Text style={styles.blockTitle}>{variable.label}</Text>
        {chips}
        <Text style={styles.empty}>{modality ? `Sem registros de ${modalityName(modality)} ainda.` : 'Sem registros ainda.'}</Text>
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
  // 02/11/2026: a faixa cinza vem do servidor (referencias anteriores, P10-P90): mesma matematica do painel e do texto. Substitui o canal calculado no celular (15/10).

  return (
    <View style={[styles.block, HomeBorder.card]}>
      <Text style={styles.blockTitle}>{variable.label}</Text>
      {chips}
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
          channel={channelPoints.length > 1 ? { points: channelPoints, label: 'sua faixa habitual (onde seus registros costumam ficar)', showMean: false } : undefined}
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
    fetchSnapshots(cfg.variables.map((v) => v.id), accessToken, { reference: true }).then((map) => { if (alive) setSnapshots(map); });
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
          {cfg.variables.map((v) => <VariableBlock key={v.id} variable={v} snapshot={snapshots[v.id]} accessToken={accessToken} />)}
          <SourcesLink themeIds={domain === 'sleep' ? ['ritmo-circadiano'] : ['neurociencia-comportamento']} />
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
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 12, paddingVertical: 5, borderRadius: 14, backgroundColor: HomeColors.surfaceHighlight },
  chipActive: { backgroundColor: HomeColors.panzeriInteraction },
  chipText: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  chipTextActive: { color: '#fff' },
  categoricalRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 3, borderBottomWidth: 1, borderBottomColor: HomeColors.divider },
  categoricalDate: { ...HomeTypography.body, color: HomeColors.textSecondary },
  categoricalValue: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  textCard: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 6 },
  textCardTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  sentence: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  disclaimer: { ...HomeTypography.tertiary, color: HomeColors.textTertiary, marginTop: 4 },
});
