import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Text as SvgText } from 'react-native-svg';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth } from './homeApi';
import { dayFromIso, formatDayLabel, formatDayLong, modalityName } from './chartData';
import { IndicatorMeaning } from './IndicatorMeaning';

// Area "Dor" da Evolucao (02/11/2026). Consumo PURO de GET /me/pain-reports/history: nenhuma conta aqui.
// Regra de Elton: treino registrado vale zero quando a aluna nao relatou dor. Resposta "nenhuma" = circulo cheio; sem resposta (treino registrado, dor nao respondida) =
// circulo vazado, tambem no zero. Os relatos avulsos ("Relatar dor") ficam numa lista a parte: sao outra escala (1 a 10) e outro tipo de relato.

type Level = 'none' | 'leve' | 'moderado' | 'forte';

interface PainEntry {
  id: string;
  date: string;
  modality: string;
  level: Level;
  answered: boolean;
  timing: string | null;
  origin: 'prescrita' | 'extra' | 'relogio';
}

interface PainReportLite {
  id: string;
  createdAt: string;
  regions: string[];
  otherLocation: string | null;
  intensity: number;
  worseningTrend: string | null;
  dailyLifeImpact: string | null;
}

const LEVEL_Y: Record<Level, number> = { none: 0, leve: 1, moderado: 2, forte: 3 };
const LEVEL_LABEL: Record<Level, string> = { none: 'Nenhuma', leve: 'Leve', moderado: 'Moderada', forte: 'Forte' };
const LEVEL_ORDER: Level[] = ['none', 'leve', 'moderado', 'forte'];
const MODALITY_COLORS = ['#1769AA', '#C58A2A', '#2F8F67', '#8B5CF6', '#C95C5C', '#5F6B7A'];
const TIMING_LABEL: Record<string, string> = {
  ja_comecei_sentindo: 'já comecei o treino sentindo',
  comeco_passou: 'no começo, e passou',
  comeco_continuou: 'no começo, e continuou',
  durante_passou: 'durante o treino, e passou',
  durante_continuou: 'durante o treino, e continuou',
  so_depois: 'só depois do treino',
};
const TREND_LABEL: Record<string, string> = { worsening: 'piorando', stable: 'estável', improving: 'melhorando' };
const IMPACT_LABEL: Record<string, string> = { yes: 'atrapalha o dia a dia', a_little: 'atrapalha um pouco o dia a dia', no: 'não atrapalha o dia a dia' };

const HEIGHT = 170;
const M = { left: 66, right: 12, top: 12, bottom: 24 };

function plural(n: number, one: string, many: string) {
  return n === 1 ? one : many;
}

function regionLabel(region: string) {
  const text = region.replace(/_/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function shortDate(iso: string) {
  return formatDayLabel(dayFromIso(iso));
}

function PainChart({ entries, colorOf }: { entries: PainEntry[]; colorOf: (modality: string) => string }) {
  const [width, setWidth] = useState(320);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const layout = useMemo(() => {
    const days = entries.map((e) => dayFromIso(e.date));
    const xMin = Math.min(...days) - 1;
    let xMax = Math.max(...days) + 1;
    if (xMax <= xMin) xMax = xMin + 2;
    const perDay = new Map<string, number>();
    entries.forEach((e) => perDay.set(e.date, (perDay.get(e.date) ?? 0) + 1));
    const seen = new Map<string, number>();
    const offsets = new Map<string, number>();
    entries.forEach((e) => {
      const index = seen.get(e.date) ?? 0;
      seen.set(e.date, index + 1);
      offsets.set(e.id, (index - ((perDay.get(e.date) ?? 1) - 1) / 2) * 8);
    });
    return { xMin, xMax, offsets };
  }, [entries]);

  const plotW = Math.max(width - M.left - M.right, 10);
  const plotH = HEIGHT - M.top - M.bottom;
  const sx = (day: number) => M.left + ((day - layout.xMin) / (layout.xMax - layout.xMin)) * plotW;
  const sy = (level: Level) => M.top + (1 - LEVEL_Y[level] / 3) * plotH;
  const px = (e: PainEntry) => sx(dayFromIso(e.date)) + (layout.offsets.get(e.id) ?? 0);

  const selected = entries.find((e) => e.id === selectedId) ?? null;
  const xTicks = [0, 1, 2, 3].map((i) => layout.xMin + ((layout.xMax - layout.xMin) * i) / 3);

  function onTouch(x: number) {
    let best: PainEntry | null = null;
    let bestDistance = Infinity;
    for (const e of entries) {
      const d = Math.abs(px(e) - x);
      if (d < bestDistance) { best = e; bestDistance = d; }
    }
    setSelectedId(best ? best.id : null);
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={styles.hint}>Toque no gráfico para ver cada treino</Text>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => onTouch(e.nativeEvent.locationX)}
        onResponderMove={(e) => onTouch(e.nativeEvent.locationX)}
      >
        <Svg width={width} height={HEIGHT}>
          {LEVEL_ORDER.map((level) => (
            <React.Fragment key={level}>
              <Line x1={M.left} x2={M.left + plotW} y1={sy(level)} y2={sy(level)} stroke={level === 'none' ? '#94A3B8' : HomeColors.divider} strokeWidth={level === 'none' ? 1.5 : 1} />
              <SvgText x={M.left - 6} y={sy(level) + 3} fontSize={10} fill={HomeColors.textTertiary} textAnchor="end">{LEVEL_LABEL[level]}</SvgText>
            </React.Fragment>
          ))}
          {xTicks.map((t) => (
            <SvgText key={t} x={sx(t)} y={HEIGHT - 8} fontSize={10} fill={HomeColors.textTertiary} textAnchor="middle">{formatDayLabel(t)}</SvgText>
          ))}
          {entries.map((e) => {
            const color = colorOf(e.modality);
            return e.answered
              ? <Circle key={e.id} cx={px(e)} cy={sy(e.level)} r={4.5} fill={color} />
              : <Circle key={e.id} cx={px(e)} cy={sy(e.level)} r={4.5} fill="#fff" stroke={color} strokeWidth={1.6} />;
          })}
          {selected ? <Circle cx={px(selected)} cy={sy(selected.level)} r={8} fill="none" stroke="#0F172A" strokeWidth={1.2} opacity={0.6} /> : null}
        </Svg>
      </View>
      {selected ? (
        <Text style={styles.selected}>
          {formatDayLong(dayFromIso(selected.date))} · {modalityName(selected.modality)} · dor {LEVEL_LABEL[selected.level].toLowerCase()}
          {selected.timing && TIMING_LABEL[selected.timing] ? ` (${TIMING_LABEL[selected.timing]})` : ''}
          {selected.answered ? '' : ' · sem resposta sobre dor: considerado zero'}
        </Text>
      ) : null}
    </View>
  );
}

export function PainArea({ accessToken, onOpenPainReport }: { accessToken: string; onOpenPainReport: () => void }) {
  const [data, setData] = useState<{ entries: PainEntry[]; reports: PainReportLite[] } | null | undefined>(undefined);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    fetchJsonAuth<{ entries: PainEntry[]; reports: PainReportLite[] }>('/me/pain-reports/history', accessToken).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [accessToken]);

  const modalities = useMemo(() => [...new Set((data?.entries ?? []).map((e) => e.modality))].sort(), [data]);
  const colorOf = (modality: string) => MODALITY_COLORS[Math.max(modalities.indexOf(modality), 0) % MODALITY_COLORS.length];
  const visible = useMemo(() => (data?.entries ?? []).filter((e) => !hidden.has(e.modality)), [data, hidden]);

  const sentences = useMemo(() => {
    const all = data?.entries ?? [];
    if (all.length === 0) return [];
    const cutoff = new Date(Date.now() - 28 * 86_400_000).toISOString().slice(0, 10);
    const recent = all.filter((e) => e.date >= cutoff);
    const out: string[] = [];
    if (recent.length === 0) {
      out.push('Você não tem treinos registrados nos últimos 28 dias.');
    } else {
      out.push(`Nos últimos 28 dias, você tem ${recent.length} ${plural(recent.length, 'treino registrado', 'treinos registrados')}.`);
      const withPain = recent.filter((e) => e.level !== 'none');
      if (withPain.length === 0) {
        out.push('Em nenhum deles houve relato de dor.');
      } else {
        const parts = (['leve', 'moderado', 'forte'] as const)
          .map((level) => ({ level, n: withPain.filter((e) => e.level === level).length }))
          .filter((p) => p.n > 0)
          .map((p) => `${p.n} ${LEVEL_LABEL[p.level].toLowerCase()}${p.n === 1 ? '' : 's'}`);
        out.push(`Em ${withPain.length} deles houve relato de dor (${parts.join(', ')}).`);
      }
      const unanswered = recent.filter((e) => !e.answered).length;
      if (unanswered > 0) out.push(`${unanswered} ${plural(unanswered, 'treino ficou', 'treinos ficaram')} sem resposta sobre dor e ${plural(unanswered, 'foi considerado', 'foram considerados')} sem dor.`);
    }
    const lastPain = [...all].reverse().find((e) => e.level !== 'none');
    if (lastPain) out.push(`O último treino com relato de dor foi em ${shortDate(lastPain.date)} (${modalityName(lastPain.modality).toLowerCase()}, dor ${LEVEL_LABEL[lastPain.level].toLowerCase()}).`);
    return out;
  }, [data]);

  if (data === undefined) return <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />;

  const reports = data ? [...data.reports].reverse().slice(0, 8) : [];

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Dor</Text>

      {data === null ? (
        <Text style={styles.empty}>Não foi possível carregar seus registros agora. Tente novamente em instantes.</Text>
      ) : data.entries.length === 0 ? (
        <Text style={styles.empty}>Conforme você registra seus treinos e responde sobre dor, esta área mostra sua evolução ao longo do tempo.</Text>
      ) : (
        <>
          <View style={[styles.block, HomeBorder.card]}>
            <Text style={styles.blockTitle}>Dor em cada treino</Text>
            {modalities.length >= 2 ? (
              <View style={styles.chips}>
                {modalities.map((m) => {
                  const off = hidden.has(m);
                  return (
                    <Pressable key={m} onPress={() => setHidden((prev) => { const next = new Set(prev); if (next.has(m)) next.delete(m); else next.add(m); return next; })} style={[styles.chip, off && styles.chipOff]}>
                      <View style={[styles.dot, { backgroundColor: off ? '#CBD5E1' : colorOf(m) }]} />
                      <Text style={[styles.chipText, off && styles.chipTextOff]}>{modalityName(m)}</Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
            {visible.length === 0 ? <Text style={styles.empty}>Escolha ao menos uma modalidade para ver o gráfico.</Text> : <PainChart entries={visible} colorOf={colorOf} />}
            <Text style={styles.hint}>
              Círculo cheio: você respondeu sobre dor naquele treino · círculo vazado: treino registrado sem resposta sobre dor, considerado sem dor. Cada treino é um ponto; dois treinos no mesmo dia aparecem lado a lado.
            </Text>
            <IndicatorMeaning id="pain.perWorkout" />
          </View>
        </>
      )}

      <View style={[styles.block, HomeBorder.card]}>
        <Text style={styles.blockTitle}>Relatos feitos em "Relatar dor"</Text>
        {reports.length === 0 ? (
          <Text style={styles.empty}>Você ainda não fez nenhum relato avulso de dor.</Text>
        ) : reports.map((r) => (
          <View key={r.id} style={styles.reportRow}>
            <Text style={styles.reportDate}>{formatDayLong(dayFromIso(r.createdAt))}</Text>
            <Text style={styles.reportText}>
              {[...r.regions.map(regionLabel), ...(r.otherLocation ? [r.otherLocation] : [])].join(', ')} · intensidade {r.intensity}/10
              {r.worseningTrend && TREND_LABEL[r.worseningTrend] ? ` · ${TREND_LABEL[r.worseningTrend]}` : ''}
              {r.dailyLifeImpact && IMPACT_LABEL[r.dailyLifeImpact] ? ` · ${IMPACT_LABEL[r.dailyLifeImpact]}` : ''}
            </Text>
          </View>
        ))}
        <IndicatorMeaning id="pain.reports" />
      </View>

      <Pressable onPress={onOpenPainReport} style={styles.button}>
        <Text style={styles.buttonText}>Relatar dor</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.related },
  title: { ...HomeTypography.greeting, color: HomeColors.textPrimary },
  subtitle: { ...HomeTypography.body, color: HomeColors.textSecondary, marginTop: -6 },
  empty: { ...HomeTypography.body, color: HomeColors.textSecondary },
  textCard: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 6 },
  textCardTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  sentence: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  disclaimer: { ...HomeTypography.tertiary, color: HomeColors.textTertiary, marginTop: 4 },
  block: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 8 },
  blockTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  hint: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },
  selected: { ...HomeTypography.body, color: HomeColors.textPrimary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 5, borderRadius: 14, backgroundColor: HomeColors.surfaceHighlight },
  chipOff: { backgroundColor: '#F1F5F9' },
  chipText: { ...HomeTypography.tertiary, color: HomeColors.textPrimary },
  chipTextOff: { color: HomeColors.textTertiary },
  dot: { width: 9, height: 9, borderRadius: 5 },
  reportRow: { paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: HomeColors.divider, gap: 2 },
  reportDate: { ...HomeTypography.label, color: HomeColors.textSecondary },
  reportText: { ...HomeTypography.body, color: HomeColors.textPrimary },
  button: { backgroundColor: HomeColors.panzeriInteraction, borderRadius: HomeRadius.small, paddingVertical: 12, alignItems: 'center' },
  buttonText: { ...HomeTypography.bodyMedium, color: '#fff' },
});
