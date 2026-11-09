import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth } from './homeApi';
import {
  BestMark, BestMarksResponse, DistanceMarks, MARKS_EXPLANATION, RANK_LABEL, SELF_REPORT_EXPLANATION,
  TOP_LIMIT, formatMarkDate, formatMarkPace, formatMarkTime, markTags, selfReportedDistanceLabel, selfReportedLine,
} from './bestMarks';

// "Melhores marcas" (09/11/2026, ordem de Elton): so' o que o Panzeri Run registrou, por distancia, mais uma subtela com o RELATO da entrevista. Somente leitura (GET /me/best-marks):
// nenhuma conta de treino aqui. Marcas sem registro ficam recolhidas e sem valor (nunca zero). O relato nunca se mistura com as marcas registradas.

function MarkRow({ mark, position }: { mark: BestMark; position: number }) {
  return (
    <View style={styles.rankRow}>
      <Text style={styles.rankPosition}>{position}º</Text>
      <View style={{ flex: 1 }}>
        <Text style={styles.rankTime}>{formatMarkTime(mark.seconds)} <Text style={styles.rankPace}>· {formatMarkPace(mark.paceSecondsKm)}</Text></Text>
        <Text style={styles.rankMeta}>{formatMarkDate(mark.startedAt)}</Text>
        <View style={styles.tags}>{markTags(mark).map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View>
      </View>
    </View>
  );
}

function DistanceCard({ entry }: { entry: DistanceMarks }) {
  const [open, setOpen] = useState(false);
  const best = entry.best;
  if (!best) {
    return (
      <View style={[styles.card, styles.cardEmpty, HomeBorder.card]}>
        <Text style={styles.cardTitleMuted}>{entry.label}</Text>
        <Text style={styles.cardHint}>Sem marca registrada</Text>
      </View>
    );
  }
  const top = entry.ranking.slice(0, TOP_LIMIT);
  return (
    <View style={[styles.card, HomeBorder.card]}>
      <Pressable onPress={() => setOpen((v) => !v)} accessibilityRole="button" accessibilityLabel={`${entry.label}, melhor marca ${formatMarkTime(best.seconds)}`} style={styles.cardHead}>
        <View style={{ flex: 1 }}>
          <Text style={styles.cardTitle}>{entry.label}</Text>
          <Text style={styles.bestTime}>{formatMarkTime(best.seconds)}</Text>
          <Text style={styles.cardHint}>{formatMarkPace(best.paceSecondsKm)} · {formatMarkDate(best.startedAt)}</Text>
          <View style={styles.tags}>{markTags(best).map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View>
        </View>
        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={HomeColors.textTertiary} />
      </Pressable>
      {open ? (
        <View style={styles.rankList}>
          <Text style={styles.rankTitle}>{top.length === 1 ? 'Sua única marca registrada' : `Suas ${top.length} melhores marcas`}</Text>
          {top.map((mark, index) => <MarkRow key={`${mark.activityId}-${mark.method}`} mark={mark} position={index + 1} />)}
        </View>
      ) : null}
    </View>
  );
}

export function BestMarksScreen({ accessToken, onBack, backLabel = 'Evolução' }: { accessToken: string; onBack: () => void; backLabel?: string }) {
  const [data, setData] = useState<BestMarksResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<'marks' | 'self'>('marks');

  const load = useCallback(async () => {
    setState('loading');
    const result = await fetchJsonAuth<BestMarksResponse>('/me/best-marks', accessToken);
    if (result) { setData(result); setState('ready'); } else setState('error');
  }, [accessToken]);
  useEffect(() => { void load(); }, [load]);

  if (view === 'self') {
    const runs = data?.selfReported ?? [];
    return (
      <View style={styles.container}>
        <Pressable onPress={() => setView('marks')} style={styles.back}>
          <Ionicons name="chevron-back" size={16} color={HomeColors.panzeriInteraction} />
          <Text style={styles.backText}>Melhores marcas</Text>
        </Pressable>
        <Text style={styles.title}>Relatos da entrevista</Text>
        <View style={styles.notice}><Text style={styles.noticeText}>{SELF_REPORT_EXPLANATION}</Text></View>
        {runs.length === 0 ? <Text style={styles.cardHint}>Você não informou distâncias na entrevista.</Text> : runs.map((run) => (
          <View key={run.rank} style={[styles.card, HomeBorder.card]}>
            <Text style={styles.cardTitleMuted}>{RANK_LABEL[run.rank]}</Text>
            <Text style={styles.bestTime}>{selfReportedDistanceLabel(run)}</Text>
            <Text style={styles.cardHint}>{selfReportedLine(run)}</Text>
            <View style={styles.tags}><Text style={styles.tag}>relato seu na entrevista</Text></View>
          </View>
        ))}
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <Pressable onPress={onBack} style={styles.back}>
        <Ionicons name="chevron-back" size={16} color={HomeColors.panzeriInteraction} />
        <Text style={styles.backText}>{backLabel}</Text>
      </Pressable>
      <Text style={styles.kicker}>MELHORES MARCAS</Text>
      <Text style={styles.title}>Seus melhores tempos</Text>
      <View style={styles.notice}><Text style={styles.noticeText}>{MARKS_EXPLANATION}</Text></View>
      {state === 'loading' && !data ? <ActivityIndicator color={HomeColors.panzeriInteraction} /> : null}
      {state === 'error' && !data ? (
        <View style={{ gap: HomeSpace.small }}>
          <Text style={styles.cardHint}>Não foi possível carregar suas marcas agora.</Text>
          <Pressable onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>Tentar de novo</Text></Pressable>
        </View>
      ) : null}
      {data ? data.marks.map((entry) => <DistanceCard key={entry.distanceId} entry={entry} />) : null}
      {data ? (
        <Pressable onPress={() => setView('self')} style={[styles.card, styles.linkCard, HomeBorder.card]}>
          <View style={{ flex: 1 }}>
            <Text style={styles.cardTitle}>Relatos da entrevista</Text>
            <Text style={styles.cardHint}>O que você contou sobre suas maiores distâncias. Fica separado das marcas registradas.</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={HomeColors.textTertiary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.related },
  kicker: { ...HomeTypography.label, color: HomeColors.panzeriInteraction, letterSpacing: 0.5 },
  title: { ...HomeTypography.greeting, color: HomeColors.textPrimary },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: HomeSpace.small },
  backText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },
  notice: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component },
  noticeText: { ...HomeTypography.body, color: HomeColors.textSecondary, lineHeight: 21 },
  card: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 4 },
  cardEmpty: { backgroundColor: HomeColors.surfaceSecondary },
  cardHead: { flexDirection: 'row', alignItems: 'flex-start', gap: HomeSpace.related },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: HomeSpace.related },
  cardTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  cardTitleMuted: { ...HomeTypography.bodyMedium, color: HomeColors.textSecondary },
  cardHint: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, lineHeight: 16 },
  bestTime: { ...HomeTypography.greeting, color: HomeColors.panzeriPrimary },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { ...HomeTypography.tertiary, color: HomeColors.panzeriInteraction, backgroundColor: HomeColors.panzeriLight, borderRadius: HomeRadius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  rankList: { marginTop: HomeSpace.related, borderTopWidth: 1, borderTopColor: HomeColors.divider, paddingTop: HomeSpace.related, gap: HomeSpace.related },
  rankTitle: { ...HomeTypography.label, color: HomeColors.textSecondary },
  rankRow: { flexDirection: 'row', gap: HomeSpace.related },
  rankPosition: { ...HomeTypography.bodyMedium, color: HomeColors.textTertiary, width: 28 },
  rankTime: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  rankPace: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  rankMeta: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  button: { backgroundColor: HomeColors.panzeriInteraction, borderRadius: HomeRadius.small, paddingVertical: 12, alignItems: 'center' },
  buttonText: { ...HomeTypography.bodyMedium, color: '#fff' },
});
