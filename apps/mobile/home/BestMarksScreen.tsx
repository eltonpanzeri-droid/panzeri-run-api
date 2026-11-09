import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Animated, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';
import { Ionicons } from '@expo/vector-icons';
import { Text } from '../src/PtText';
import { scrollAppToWindowY } from '../src/appScroll';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth } from './homeApi';
import { BestMarksChart } from './BestMarksChart';
import {
  BestMark, BestMarksResponse, DistanceMarks, HOW_COLLECTED_STEPS, MANUAL_REVIEW_INTRO, RANK_LABEL, SELF_REPORT_EXPLANATION, TOP_LIMIT,
  formatMarkDate, formatMarkPace, formatMarkTime, howCollected, isRecentMark, markChartPoints, markKey, markTags, marksSummary, selfReportedDistanceLabel, selfReportedLine, sparklinePoints,
} from './bestMarks';

// "Melhores marcas" (09/11/2026, ordem de Elton): so' o que o Panzeri Run registrou, por distancia. Painel de resumo, cartoes em grade com mini-grafico e selo "novo", detalhe animado da distancia
// escolhida (rola ate ele), grafico de evolucao tocavel, as 10 melhores com medalhas, "como esta marca foi coletada", botao que ABRE o treino e a lista dos registros manuais com o motivo de cada um.
// Subtela com o RELATO da entrevista, sempre separado. Somente leitura (GET /me/best-marks): nenhuma conta de treino aqui.

const MEDAL_COLORS = ['#D4A017', '#9AA5B1', '#B87333'];

function Spark({ ranking, active }: { ranking: BestMark[]; active: boolean }) {
  const points = sparklinePoints(ranking);
  const width = 84;
  const height = 26;
  if (points.length < 2) return <View style={{ height }} />;
  const color = active ? '#FFFFFF' : HomeColors.panzeriAccent;
  const xy = points.map((point) => ({ x: 3 + point.x * (width - 6), y: 3 + point.y * (height - 6) }));
  return (
    <Svg width={width} height={height}>
      <Polyline points={xy.map((point) => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth={2} opacity={0.85} />
      <Circle cx={xy[xy.length - 1].x} cy={xy[xy.length - 1].y} r={3.5} fill={color} />
    </Svg>
  );
}

function FadeIn({ k, children }: { k: string; children: React.ReactNode }) {
  const value = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    value.setValue(0);
    Animated.timing(value, { toValue: 1, duration: 260, useNativeDriver: true }).start();
  }, [k, value]);
  return <Animated.View style={{ opacity: value, transform: [{ translateY: value.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }], gap: HomeSpace.related }}>{children}</Animated.View>;
}

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
  const [showManual, setShowManual] = useState(false);
  const detailRef = useRef<View>(null);

  const load = useCallback(async () => {
    setState('loading');
    const result = await fetchJsonAuth<BestMarksResponse>('/me/best-marks', accessToken);
    if (result) { setData(result); setState('ready'); } else setState('error');
  }, [accessToken]);
  useEffect(() => { void load(); }, [load]);

  const summary = useMemo(() => (data ? marksSummary(data.marks) : null), [data]);
  const current: DistanceMarks | null = useMemo(() => {
    if (!data) return null;
    return data.marks.find((entry) => entry.distanceId === distanceId) ?? data.marks.find((entry) => entry.best) ?? data.marks[0] ?? null;
  }, [data, distanceId]);
  const points = useMemo(() => (current ? markChartPoints(current.ranking) : []), [current]);
  const selectedMark: BestMark | null = useMemo(() => (current ? (current.ranking.find((mark) => markKey(mark) === selectedKey) ?? current.best) : null), [current, selectedKey]);

  function pickDistance(entry: DistanceMarks) {
    setDistanceId(entry.distanceId);
    setSelectedKey(null);
    // rola ate o detalhe da distancia escolhida (depois de o detalhe aparecer)
    setTimeout(() => {
      const node = detailRef.current as unknown as { measureInWindow?: (cb: (x: number, y: number) => void) => void } | null;
      node?.measureInWindow?.((_x, y) => { scrollAppToWindowY(y, 16); });
    }, 320);
  }

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

  const manualRows = data?.manualReview ?? [];

  return (
    <View style={styles.container}>
      <Pressable onPress={onBack} style={styles.back}>
        <Ionicons name="chevron-back" size={16} color={HomeColors.panzeriInteraction} />
        <Text style={styles.backText}>{backLabel}</Text>
      </Pressable>

      <View style={styles.hero}>
        <View style={styles.heroRow}>
          <View style={styles.heroIcon}><Ionicons name="trophy" size={26} color="#F5C84B" /></View>
          <View style={{ flex: 1 }}>
            <Text style={styles.heroKicker}>MELHORES MARCAS</Text>
            <Text style={styles.heroTitle}>Seus melhores tempos</Text>
          </View>
        </View>
        {summary ? (
          <View style={styles.heroStats}>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>{summary.withMark}<Text style={styles.heroStatSmall}> de {summary.total}</Text></Text><Text style={styles.heroStatLabel}>distâncias com marca</Text></View>
            <View style={styles.heroStat}><Text style={styles.heroStatValue}>{summary.latest ? summary.latest.label : '—'}</Text><Text style={styles.heroStatLabel}>{summary.latest ? `mais recente · ${formatMarkDate(summary.latest.localDate)}` : 'sem marcas ainda'}</Text></View>
          </View>
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
          <Text style={styles.sectionLabel}>TOQUE EM UMA DISTÂNCIA</Text>
          <View style={styles.grid}>
            {data.marks.map((entry) => {
              const active = entry.distanceId === current.distanceId;
              const best = entry.best;
              return (
                <Pressable key={entry.distanceId} onPress={() => pickDistance(entry)} accessibilityRole="button" accessibilityState={{ selected: active }} accessibilityLabel={best ? `${entry.label}, melhor marca ${formatMarkTime(best.seconds)}` : `${entry.label}, sem marca`} style={({ pressed }) => [styles.tile, active && styles.tileActive, !best && !active && styles.tileEmpty, pressed && { opacity: 0.85, transform: [{ scale: 0.98 }] }]}>
                  <View style={styles.tileHead}>
                    <Text style={[styles.tileLabel, active && styles.tileTextActive]}>{entry.label}</Text>
                    {best && isRecentMark(best.localDate) ? <Text style={[styles.newBadge, active && styles.newBadgeActive]}>NOVO</Text> : null}
                  </View>
                  <Text style={[styles.tileTime, active && styles.tileTextActive, !best && styles.tileTimeEmpty]}>{best ? formatMarkTime(best.seconds) : '—'}</Text>
                  <Text style={[styles.tileMeta, active && styles.tileMetaActive]}>{best ? `${formatMarkPace(best.paceSecondsKm)} · ${formatMarkDate(best.localDate)}` : 'sem marca'}</Text>
                  <Spark ranking={entry.ranking} active={active} />
                </Pressable>
              );
            })}
          </View>

          <View ref={detailRef} collapsable={false}>
            {!current.best || !selectedMark ? (
              <FadeIn k={`${current.distanceId}-empty`}>
                <View style={[styles.card, styles.cardEmpty, HomeBorder.card]}>
                  <Text style={styles.cardTitleMuted}>{current.label}</Text>
                  <Text style={styles.hint}>Sem marca registrada nesta distância. Ela aparece quando você correr {current.label} ou mais e o treino chegar ao Panzeri Run.</Text>
                </View>
              </FadeIn>
            ) : (
              <FadeIn k={`${current.distanceId}-${markKey(selectedMark)}`}>
                <View style={styles.detailHero}>
                  <View style={styles.detailTop}>
                    <Ionicons name={selectedMark === current.best ? 'trophy' : 'ribbon'} size={20} color="#F5C84B" />
                    <Text style={styles.detailKicker}>{current.label} · {selectedMark === current.best ? 'sua melhor marca' : 'marca selecionada'}</Text>
                  </View>
                  <Text style={styles.detailTime}>{formatMarkTime(selectedMark.seconds)}</Text>
                  <Text style={styles.detailSub}>{formatMarkPace(selectedMark.paceSecondsKm)} · {formatMarkDate(selectedMark.localDate)}</Text>
                  <View style={styles.tags}>{markTags(selectedMark).map((tag) => <Text key={tag} style={styles.tagLight}>{tag}</Text>)}</View>
                  <Pressable onPress={() => openTraining(selectedMark)} accessibilityRole="button" accessibilityLabel={`Abrir o treino de ${formatMarkDate(selectedMark.localDate)}`} style={({ pressed }) => [styles.openButton, pressed && { opacity: 0.85 }]}>
                    <Ionicons name={selectedMark.source === 'device' ? 'play-circle-outline' : 'calendar-outline'} size={18} color={HomeColors.panzeriPrimary} />
                    <Text style={styles.openButtonText}>{selectedMark.source === 'device' ? 'Abrir o treino' : 'Ver a semana do treino'}</Text>
                  </Pressable>
                </View>

                <View style={[styles.card, HomeBorder.card]}>
                  <Text style={styles.sectionTitle}>Evolução em {current.label}</Text>
                  <BestMarksChart points={points} selectedKey={markKey(selectedMark)} onSelect={setSelectedKey} />
                </View>

                <View style={[styles.card, styles.collectCard, HomeBorder.card]}>
                  <Text style={styles.sectionTitle}>Como esta marca foi coletada</Text>
                  {howCollected(selectedMark, current.label).map((line, index) => (
                    <View key={index} style={styles.stepRow}>
                      <Ionicons name="checkmark-circle" size={16} color={HomeColors.success} style={{ marginTop: 2 }} />
                      <Text style={[styles.noticeText, { flex: 1 }]}>{line}</Text>
                    </View>
                  ))}
                </View>

                <View style={[styles.card, HomeBorder.card]}>
                  <Text style={styles.sectionTitle}>{current.ranking.length === 1 ? 'Sua única marca registrada' : `Suas ${Math.min(current.ranking.length, TOP_LIMIT)} melhores marcas`}</Text>
                  {current.ranking.slice(0, TOP_LIMIT).map((mark, index) => {
                    const active = markKey(mark) === markKey(selectedMark);
                    return (
                      <Pressable key={markKey(mark)} onPress={() => setSelectedKey(markKey(mark))} accessibilityRole="button" style={({ pressed }) => [styles.rankRow, active && styles.rankRowActive, pressed && { opacity: 0.85 }]}>
                        {index < 3 ? <Ionicons name="medal" size={22} color={MEDAL_COLORS[index]} style={styles.rankMedal} /> : <Text style={styles.rankPosition}>{index + 1}º</Text>}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.rankTime}>{formatMarkTime(mark.seconds)} <Text style={styles.rankPace}>· {formatMarkPace(mark.paceSecondsKm)}</Text></Text>
                          <Text style={styles.rankMeta}>{formatMarkDate(mark.localDate)} · {markTags(mark)[0]}</Text>
                        </View>
                        <Pressable onPress={() => openTraining(mark)} hitSlop={10} accessibilityRole="button" accessibilityLabel={`Abrir o treino de ${formatMarkDate(mark.localDate)}`}>
                          <Ionicons name="open-outline" size={20} color={HomeColors.panzeriInteraction} />
                        </Pressable>
                      </Pressable>
                    );
                  })}
                </View>
              </FadeIn>
            )}
          </View>

          <Pressable onPress={() => setShowManual((v) => !v)} accessibilityRole="button" style={[styles.card, styles.howHeader, HomeBorder.card]}>
            <Ionicons name="create-outline" size={20} color={HomeColors.panzeriInteraction} />
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Meus registros manuais de corrida</Text>
              <Text style={styles.hint}>{manualRows.length === 0 ? 'Nenhum registro manual' : `${manualRows.filter((row) => row.included).length} de ${manualRows.length} entram nas marcas`}</Text>
            </View>
            <Ionicons name={showManual ? 'chevron-up' : 'chevron-down'} size={18} color={HomeColors.textTertiary} />
          </Pressable>
          {showManual ? (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{MANUAL_REVIEW_INTRO}</Text>
              {manualRows.map((row, index) => (
                <View key={`${row.localDate}-${index}`} style={styles.stepRow}>
                  <Ionicons name={row.included ? 'checkmark-circle' : 'remove-circle-outline'} size={18} color={row.included ? HomeColors.success : HomeColors.textTertiary} style={{ marginTop: 1 }} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rankTime}>{formatMarkDate(row.localDate)} · {row.distanceKm != null ? `${String(row.distanceKm).replace('.', ',')} km` : 'sem distância'} · {row.durationMin != null ? `${Math.round(row.durationMin)} min` : 'sem tempo'}</Text>
                    <Text style={styles.rankMeta}>{row.included ? 'Entra nas marcas' : 'Não entra'}: {row.reason}</Text>
                  </View>
                </View>
              ))}
            </View>
          ) : null}

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
  hero: { backgroundColor: HomeColors.panzeriPrimary, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.block, gap: HomeSpace.related },
  heroRow: { flexDirection: 'row', alignItems: 'center', gap: HomeSpace.related },
  heroIcon: { width: 48, height: 48, borderRadius: 24, backgroundColor: 'rgba(255,255,255,0.14)', alignItems: 'center', justifyContent: 'center' },
  heroKicker: { ...HomeTypography.label, color: 'rgba(255,255,255,0.7)', letterSpacing: 0.6 },
  heroTitle: { ...HomeTypography.greeting, color: '#fff' },
  heroText: { ...HomeTypography.body, color: 'rgba(255,255,255,0.88)' },
  heroStats: { flexDirection: 'row', gap: HomeSpace.block, flexWrap: 'wrap' },
  heroStat: { gap: 2 },
  heroStatValue: { ...HomeTypography.greeting, color: '#fff' },
  heroStatSmall: { ...HomeTypography.body, color: 'rgba(255,255,255,0.7)' },
  heroStatLabel: { ...HomeTypography.tertiary, color: 'rgba(255,255,255,0.75)' },
  notice: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: HomeSpace.related },
  noticeText: { ...HomeTypography.body, color: HomeColors.textSecondary, lineHeight: 21 },
  stepRow: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  stepNumber: { ...HomeTypography.label, color: '#fff', backgroundColor: HomeColors.panzeriInteraction, width: 20, height: 20, borderRadius: 10, textAlign: 'center', lineHeight: 20, overflow: 'hidden' },
  sectionLabel: { ...HomeTypography.label, color: HomeColors.textSecondary, letterSpacing: 0.6, marginTop: HomeSpace.small },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: HomeSpace.related },
  tile: { width: '48%', flexGrow: 1, backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, borderWidth: 1, borderColor: HomeColors.divider, padding: HomeSpace.component, gap: 4 },
  tileActive: { backgroundColor: HomeColors.panzeriInteraction, borderColor: HomeColors.panzeriInteraction },
  tileEmpty: { backgroundColor: HomeColors.surfaceSecondary },
  tileHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  tileLabel: { ...HomeTypography.bodyMedium, color: HomeColors.textSecondary },
  tileTextActive: { color: '#fff' },
  tileTime: { ...HomeTypography.greeting, fontSize: 26, lineHeight: 30, color: HomeColors.panzeriPrimary },
  tileTimeEmpty: { color: HomeColors.textTertiary },
  tileMeta: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  tileMetaActive: { color: 'rgba(255,255,255,0.85)' },
  newBadge: { ...HomeTypography.label, fontSize: 10, color: '#fff', backgroundColor: HomeColors.success, borderRadius: HomeRadius.pill, paddingHorizontal: 7, paddingVertical: 1, overflow: 'hidden' },
  newBadgeActive: { backgroundColor: '#F5C84B', color: HomeColors.panzeriPrimary },
  detailHero: { backgroundColor: HomeColors.panzeriPrimary, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.block, gap: 6 },
  detailTop: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  detailKicker: { ...HomeTypography.label, color: 'rgba(255,255,255,0.8)', letterSpacing: 0.5, textTransform: 'uppercase' },
  detailTime: { ...HomeTypography.greeting, fontSize: 48, lineHeight: 54, color: '#fff' },
  detailSub: { ...HomeTypography.body, color: 'rgba(255,255,255,0.85)' },
  openButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#fff', borderRadius: HomeRadius.small, paddingVertical: 12, marginTop: HomeSpace.small },
  openButtonText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriPrimary },
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
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  tag: { ...HomeTypography.tertiary, color: HomeColors.panzeriInteraction, backgroundColor: HomeColors.panzeriLight, borderRadius: HomeRadius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  tagLight: { ...HomeTypography.tertiary, color: '#fff', backgroundColor: 'rgba(255,255,255,0.16)', borderRadius: HomeRadius.pill, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  rankRow: { flexDirection: 'row', alignItems: 'center', gap: HomeSpace.related, paddingVertical: 10, paddingHorizontal: 8, borderRadius: HomeRadius.small },
  rankRowActive: { backgroundColor: HomeColors.surfaceHighlight },
  rankMedal: { width: 28, textAlign: 'center' },
  rankPosition: { ...HomeTypography.bodyMedium, color: HomeColors.textTertiary, width: 28, textAlign: 'center' },
  rankTime: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  rankPace: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  rankMeta: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  button: { backgroundColor: HomeColors.panzeriInteraction, borderRadius: HomeRadius.small, paddingVertical: 12, alignItems: 'center' },
  buttonText: { ...HomeTypography.bodyMedium, color: '#fff' },
});
