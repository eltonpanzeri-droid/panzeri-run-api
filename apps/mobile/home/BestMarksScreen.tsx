import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth } from './homeApi';
import { BestMarksChart } from './BestMarksChart';
import {
  BestMark, BestMarksResponse, DistanceMarks, HOW_COLLECTED_STEPS, RANK_LABEL, SELF_REPORT_EXPLANATION, TOP_LIMIT,
  formatMarkDate, formatMarkPace, formatMarkTime, howCollected, markChartPoints, markKey, markTags, marksSummary, selfReportedDistanceLabel, selfReportedLine,
} from './bestMarks';

// "Melhores marcas" (09/11/2026, ordem de Elton): so' o que o Panzeri Run registrou, por distancia. Resumo no topo, explicacao de como as marcas sao coletadas, seletor de distancia, grafico de
// evolucao (toque num ponto), as 10 melhores, "como esta marca foi coletada" e botao que ABRE o treino (atividade do relogio) ou a semana do registro manual/teste. Subtela com o RELATO da
// entrevista, sempre separado. Somente leitura (GET /me/best-marks): nenhuma conta de treino aqui.

export function BestMarksScreen({ accessToken, onBack, onOpenActivity, onOpenWeekOfDate, backLabel = 'Evolução' }: {
  accessToken: string;
  onBack: () => void;
  /** Abre o "Treino completo" da atividade do relógio. */
  onOpenActivity: (activityLogId: string) => void;
  /** Abre a semana do dia informado ('YYYY-MM-DD'): usado em registro manual e no teste de 3 km. */
  onOpenWeekOfDate: (localDate: string) => void;
  backLabel?: string;
}) {
  const [data, setData] = useState<BestMarksResponse | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [view, setView] = useState<'marks' | 'self'>('marks');
  const [distanceId, setDistanceId] = useState<string | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [showHow, setShowHow] = useState(false);

  const load = useCallback(async () => {
    setState('loading');
    const result = await fetchJsonAuth<BestMarksResponse>('/me/best-marks', accessToken);
    if (result) { setData(result); setState('ready'); } else setState('error');
  }, [accessToken]);
  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => (data ? marksSummary(data.marks) : null), [data]);
  // Distancia aberta: a escolhida; senao, a primeira com marca.
  const current: DistanceMarks | null = useMemo(() => {
    if (!data) return null;
    return data.marks.find((entry) => entry.distanceId === distanceId) ?? data.marks.find((entry) => entry.best) ?? data.marks[0] ?? null;
  }, [data, distanceId]);
  const points = useMemo(() => (current ? markChartPoints(current.ranking) : []), [current]);
  const selectedMark: BestMark | null = useMemo(() => {
    if (!current) return null;
    return current.ranking.find((mark) => markKey(mark) === selectedKey) ?? current.best;
  }, [current, selectedKey]);

  function openTraining(mark: BestMark) {
    if (mark.source === 'device') onOpenActivity(mark.activityId);
    else onOpenWeekOfDate(mark.localDate);
  }

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
        {runs.length === 0 ? <Text style={styles.hint}>Você não informou distâncias na entrevista.</Text> : runs.map((run) => (
          <View key={run.rank} style={[styles.card, HomeBorder.card]}>
            <Text style={styles.cardTitleMuted}>{RANK_LABEL[run.rank]}</Text>
            <Text style={styles.bigValue}>{selfReportedDistanceLabel(run)}</Text>
            <Text style={styles.hint}>{selfReportedLine(run)}</Text>
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

      <View style={styles.hero}>
        <View style={styles.heroIcon}><Ionicons name="trophy-outline" size={24} color="#fff" /></View>
        <Text style={styles.heroKicker}>MELHORES MARCAS</Text>
        <Text style={styles.heroTitle}>Seus melhores tempos</Text>
        {summary ? (
          <Text style={styles.heroText}>
            {summary.withMark === 0 ? 'Ainda não há marcas registradas. Elas aparecem conforme você corre e registra seus treinos.' : `${summary.withMark} de ${summary.total} distâncias com marca registrada.${summary.latest ? ` Marca mais recente: ${summary.latest.label}, em ${formatMarkDate(summary.latest.localDate)}.` : ''}`}
          </Text>
        ) : <Text style={styles.heroText}>Carregando suas marcas...</Text>}
      </View>

      <Pressable onPress={() => setShowHow((v) => !v)} accessibilityRole="button" style={[styles.card, styles.howHeader, HomeBorder.card]}>
        <Ionicons name="information-circle-outline" size={20} color={HomeColors.panzeriInteraction} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Como as marcas são coletadas</Text>
        <Ionicons name={showHow ? 'chevron-up' : 'chevron-down'} size={18} color={HomeColors.textTertiary} />
      </Pressable>
      {showHow ? (
        <View style={styles.notice}>
          {HOW_COLLECTED_STEPS.map((step, index) => (
            <View key={index} style={styles.stepRow}>
              <Text style={styles.stepNumber}>{index + 1}</Text>
              <Text style={[styles.noticeText, { flex: 1 }]}>{step}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {state === 'loading' && !data ? <ActivityIndicator color={HomeColors.panzeriInteraction} /> : null}
      {state === 'error' && !data ? (
        <View style={{ gap: HomeSpace.small }}>
          <Text style={styles.hint}>Não foi possível carregar suas marcas agora.</Text>
          <Pressable onPress={() => void load()} style={styles.button}><Text style={styles.buttonText}>Tentar de novo</Text></Pressable>
        </View>
      ) : null}

      {data && current ? (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
            {data.marks.map((entry) => {
              const active = entry.distanceId === current.distanceId;
              return (
                <Pressable key={entry.distanceId} onPress={() => { setDistanceId(entry.distanceId); setSelectedKey(null); }} accessibilityRole="button" accessibilityState={{ selected: active }} style={[styles.chip, active && styles.chipActive, !entry.best && !active && styles.chipEmpty]}>
                  <Text style={[styles.chipText, active && styles.chipTextActive]}>{entry.label}</Text>
                  {entry.best ? <View style={[styles.chipDot, active && { backgroundColor: '#fff' }]} /> : null}
                </Pressable>
              );
            })}
          </ScrollView>

          {!current.best ? (
            <View style={[styles.card, styles.cardEmpty, HomeBorder.card]}>
              <Text style={styles.cardTitleMuted}>{current.label}</Text>
              <Text style={styles.hint}>Sem marca registrada nesta distância. Ela aparece quando você correr {current.label} ou mais e o treino chegar ao Panzeri Run.</Text>
            </View>
          ) : (
            <>
              <View style={[styles.card, HomeBorder.card]}>
                <Text style={styles.cardTitleMuted}>{current.label} · {selectedMark === current.best ? 'sua melhor marca' : 'marca selecionada'}</Text>
                {selectedMark ? (
                  <>
                    <Text style={styles.bigValue}>{formatMarkTime(selectedMark.seconds)}</Text>
                    <Text style={styles.hint}>{formatMarkPace(selectedMark.paceSecondsKm)}</Text>
                    <Pressable onPress={() => openTraining(selectedMark)} accessibilityRole="button" accessibilityLabel={`Abrir o treino de ${formatMarkDate(selectedMark.localDate)}`} style={styles.dateLink}>
                      <Ionicons name="calendar-outline" size={16} color={HomeColors.panzeriInteraction} />
                      <Text style={styles.dateLinkText}>{formatMarkDate(selectedMark.localDate)} · {selectedMark.source === 'device' ? 'abrir o treino' : 'ver a semana'} ›</Text>
                    </Pressable>
                    <View style={styles.tags}>{markTags(selectedMark).map((tag) => <Text key={tag} style={styles.tag}>{tag}</Text>)}</View>
                  </>
                ) : null}
              </View>

              <View style={[styles.card, HomeBorder.card]}>
                <Text style={styles.sectionTitle}>Evolução em {current.label}</Text>
                <BestMarksChart points={points} selectedKey={selectedMark ? markKey(selectedMark) : null} onSelect={setSelectedKey} />
              </View>

              {selectedMark ? (
                <View style={[styles.card, styles.collectCard, HomeBorder.card]}>
                  <Text style={styles.sectionTitle}>Como esta marca foi coletada</Text>
                  {howCollected(selectedMark, current.label).map((line, index) => (
                    <View key={index} style={styles.stepRow}>
                      <Ionicons name="checkmark-circle-outline" size={16} color={HomeColors.success} style={{ marginTop: 2 }} />
                      <Text style={[styles.noticeText, { flex: 1 }]}>{line}</Text>
                    </View>
                  ))}
                </View>
              ) : null}

              <View style={[styles.card, HomeBorder.card]}>
                <Text style={styles.sectionTitle}>{current.ranking.length === 1 ? 'Sua única marca registrada' : `Suas ${Math.min(current.ranking.length, TOP_LIMIT)} melhores marcas`}</Text>
                {current.ranking.slice(0, TOP_LIMIT).map((mark, index) => {
                  const active = selectedMark ? markKey(mark) === markKey(selectedMark) : false;
                  return (
                    <Pressable key={markKey(mark)} onPress={() => setSelectedKey(markKey(mark))} accessibilityRole="button" style={[styles.rankRow, active && styles.rankRowActive]}>
                      <Text style={styles.rankPosition}>{index + 1}º</Text>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.rankTime}>{formatMarkTime(mark.seconds)} <Text style={styles.rankPace}>· {formatMarkPace(mark.paceSecondsKm)}</Text></Text>
                        <Text style={styles.rankMeta}>{formatMarkDate(mark.localDate)} · {markTags(mark)[0]}</Text>
                      </View>
                      <Pressable onPress={() => openTraining(mark)} hitSlop={8} accessibilityRole="button" accessibilityLabel={`Abrir o treino de ${formatMarkDate(mark.localDate)}`}>
                        <Ionicons name="open-outline" size={18} color={HomeColors.panzeriInteraction} />
                      </Pressable>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <Pressable onPress={() => setView('self')} style={[styles.card, styles.linkCard, HomeBorder.card]}>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Relatos da entrevista</Text>
              <Text style={styles.hint}>O que você contou sobre suas maiores distâncias. Fica separado das marcas registradas.</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={HomeColors.textTertiary} />
          </Pressable>
        </>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.related },
  title: { ...HomeTypography.greeting, color: HomeColors.textPrimary },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: HomeSpace.small },
  backText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },
  hero: { backgroundColor: HomeColors.panzeriPrimary, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.block, gap: 6 },
  heroIcon: { width: 44, height: 44, borderRadius: 22, backgroundColor: 'rgba(255,255,255,0.16)', alignItems: 'center', justifyContent: 'center', marginBottom: 4 },
  heroKicker: { ...HomeTypography.label, color: 'rgba(255,255,255,0.75)', letterSpacing: 0.6 },
  heroTitle: { ...HomeTypography.greeting, color: '#fff' },
  heroText: { ...HomeTypography.body, color: 'rgba(255,255,255,0.88)', lineHeight: 21 },
  notice: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: HomeSpace.related },
  noticeText: { ...HomeTypography.body, color: HomeColors.textSecondary, lineHeight: 21 },
  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNumber: { ...HomeTypography.label, color: '#fff', backgroundColor: HomeColors.panzeriInteraction, width: 20, height: 20, borderRadius: 10, textAlign: 'center', lineHeight: 20, overflow: 'hidden' },
  card: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 6 },
  cardEmpty: { backgroundColor: HomeColors.surfaceSecondary },
  collectCard: { backgroundColor: HomeColors.surfaceHighlight },
  howHeader: { flexDirection: 'row', alignItems: 'center', gap: HomeSpace.related },
  linkCard: { flexDirection: 'row', alignItems: 'center', gap: HomeSpace.related },
  cardTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  cardTitleMuted: { ...HomeTypography.bodyMedium, color: HomeColors.textSecondary },
  sectionTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary, marginBottom: 2 },
  hint: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, lineHeight: 16 },
  bigValue: { ...HomeTypography.greeting, fontSize: 34, lineHeight: 40, color: HomeColors.panzeriPrimary },
  dateLink: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6 },
  dateLinkText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },
  chips: { gap: 8, paddingVertical: 2, paddingRight: HomeSpace.component },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 14, paddingVertical: 9, borderRadius: HomeRadius.pill, backgroundColor: HomeColors.surface, borderWidth: 1, borderColor: HomeColors.divider },
  chipActive: { backgroundColor: HomeColors.panzeriInteraction, borderColor: HomeColors.panzeriInteraction },
  chipEmpty: { backgroundColor: HomeColors.surfaceSecondary },
  chipText: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  chipTextActive: { color: '#fff' },
  chipDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: HomeColors.panzeriInteraction },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { ...HomeTypography.tertiary, color: HomeColors.panzeriInteraction, backgroundColor: HomeColors.panzeriLight, borderRadius: HomeRadius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: HomeSpace.related, paddingVertical: 10, paddingHorizontal: 8, borderRadius: HomeRadius.small },
  rankRowActive: { backgroundColor: HomeColors.surfaceHighlight },
  rankPosition: { ...HomeTypography.bodyMedium, color: HomeColors.textTertiary, width: 28 },
  rankTime: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  rankPace: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  rankMeta: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  button: { backgroundColor: HomeColors.panzeriInteraction, borderRadius: HomeRadius.small, paddingVertical: 12, alignItems: 'center' },
  buttonText: { ...HomeTypography.bodyMedium, color: '#fff' },
});
