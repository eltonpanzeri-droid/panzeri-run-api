import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

// "Treino completo" (Bloco 1, 04/10/2026). Consome SO' o payload canonico de
// GET /me/activity-reconciliation/:id/detail (ActivityTimeSeriesPoint agregado no backend).
// Nenhum valor e' inventado: metrica ausente nao gera grafico; prescricao e execucao aparecem como
// valores objetivos, sem nota nem classificacao "bom/ruim".

export interface ActivityDetailSplit {
  kmIndex: number;
  isPartial: boolean;
  distanceKm: number;
  durationSec: number;
  paceSecondsKm: number | null;
  avgHeartRateBpm: number | null;
  avgCadenceSpm: number | null;
  startKm?: number;
  segmentIndex?: number | null;
  // Melhorias pos-Bloco 1 (04/10/2026): pace prescrito explicito na propria parcial.
  prescribedPaceFastSecondsKm?: number | null;
  prescribedPaceSlowSecondsKm?: number | null;
}
export interface ActivityDetailChartPoint {
  offsetSec: number;
  distanceMeters?: number | null;
  heartRateBpm: number | null;
  speedKmh: number | null;
  cadenceSpm: number | null;
}
export interface ActivityDetailSegment {
  index: number;
  label: string;
  startKm: number;
  endKm: number;
  paceFastSecondsKm: number | null;
  paceSlowSecondsKm: number | null;
  realized: {
    distanceKm: number;
    durationSec: number;
    paceSecondsKm: number | null;
    avgHeartRateBpm: number | null;
    avgCadenceSpm: number | null;
  } | null;
}
// Melhorias pos-Blocos 1/3/4 (04/10/2026): resumo deterministico pos-treino, ja calculado pelo
// backend (ExecutionSummary) — so diferencas numericas (prescrito - realizado), nunca nota/score.
// Preparado para consumo futuro pelo contexto longitudinal/Training Intelligence; aqui so exibe.
export interface ActivityExecutionSummary {
  distance: { prescribedKm: number | null; realizedKm: number | null; deltaKm: number | null };
  duration: { prescribedSec: number | null; realizedSec: number | null; deltaSec: number | null };
  pace: {
    prescribedFastSecondsKm: number | null;
    prescribedSlowSecondsKm: number | null;
    realizedSecondsKm: number | null;
    deltaVsFastSecondsKm: number | null;
    deltaVsSlowSecondsKm: number | null;
  };
  segments: Array<{
    index: number;
    label: string;
    prescribedDistanceKm: number;
    realizedDistanceKm: number | null;
    deltaDistanceKm: number | null;
    prescribedPaceFastSecondsKm: number | null;
    prescribedPaceSlowSecondsKm: number | null;
    realizedPaceSecondsKm: number | null;
    deltaPaceVsFastSecondsKm: number | null;
    deltaPaceVsSlowSecondsKm: number | null;
  }>;
}

export interface ActivityDetail {
  activityLogId: string;
  provider: string;
  startedAt: string;
  summary: {
    distanceKm: number | null;
    durationSec: number | null;
    avgPaceSecondsKm: number | null;
    avgHeartRateBpm: number | null;
    maxHeartRateBpm: number | null;
    cadenceAvg: number | null;
    caloriesKcal: number | null;
  };
  prescribed: { title: string; distanceKm: number | null; durationMin: number | null } | null;
  prescribedSegments?: ActivityDetailSegment[];
  executionSummary?: ActivityExecutionSummary | null;
  splits: ActivityDetailSplit[];
  chart: ActivityDetailChartPoint[];
  chartAxis?: 'distance' | 'time';
}

const BLUE = '#1769AA';
const GRID = '#e2e8f0';
const MUTED = '#64748b';

export function formatDurationSec(seconds: number) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
}

export function formatPace(secondsPerKm: number) {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function roundKm(value: number) {
  return Math.round(value * 100) / 100;
}

// Diferenca numerica simples ("+0,08 km" / "-0,12 km"), sem nenhuma palavra de julgamento.
function formatDeltaKm(value: number) {
  const rounded = roundKm(Math.abs(value));
  return `${value >= 0 ? '+' : '-'}${String(rounded).replace('.', ',')} km`;
}

function formatDeltaSeconds(value: number) {
  const rounded = Math.round(Math.abs(value));
  return `${value >= 0 ? '+' : '-'}${rounded} s/km`;
}

function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const rawStep = (max - min) / count;
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / magnitude;
  const step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * magnitude;
  const ticks: number[] = [];
  for (let t = Math.ceil(min / step) * step; t <= max + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6);
  return ticks;
}

interface ChartBand {
  from: number; // x
  to: number;
  yFast: number | null; // faixa de valor (mesma unidade do eixo Y)
  ySlow: number | null;
  label: string;
}

interface DetailChartProps {
  title: string;
  unit: string;
  points: Array<{ x: number; y: number | null }>;
  xLabel: 'km' | 'min';
  formatY: (v: number) => string;
  // Pace: menor valor = mais rapido, fica em cima.
  higherIsUp: boolean;
  bands?: ChartBand[];
  boundaries?: number[];
}

const HEIGHT = 190;
const M = { left: 46, right: 10, top: 12, bottom: 24 };

function DetailChart({ title, unit, points, xLabel, formatY, higherIsUp, bands, boundaries }: DetailChartProps) {
  const [width, setWidth] = useState(320);
  const [cursor, setCursor] = useState<number | null>(null);

  const real = useMemo(() => points.filter((p): p is { x: number; y: number } => p.y != null), [points]);
  const geometry = useMemo(() => {
    if (real.length === 0) return null;
    const ys = real.map((p) => p.y).sort((a, b) => a - b);
    // Percentis 2-98: um trecho parado/ruido nao achata o grafico inteiro (valores fora ficam presos na borda).
    let lo = ys[Math.floor(ys.length * 0.02)];
    let hi = ys[Math.min(ys.length - 1, Math.floor(ys.length * 0.98))];
    for (const b of bands ?? []) {
      for (const v of [b.yFast, b.ySlow]) {
        if (v != null) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
      }
    }
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    const pad = (hi - lo) * 0.08;
    const yMin = lo - pad;
    const yMax = hi + pad;
    const xMin = real[0].x;
    const xMax = real[real.length - 1].x;
    return { yMin, yMax, xMin, xMax: xMax > xMin ? xMax : xMin + 1 };
  }, [real, bands]);

  if (!geometry) return null;
  const { yMin, yMax, xMin, xMax } = geometry;
  const plotW = Math.max(width - M.left - M.right, 10);
  const plotH = HEIGHT - M.top - M.bottom;
  const sx = (x: number) => M.left + ((x - xMin) / (xMax - xMin)) * plotW;
  const sy = (y: number) => {
    const clamped = Math.min(Math.max(y, yMin), yMax);
    const ratio = (clamped - yMin) / (yMax - yMin);
    return M.top + (higherIsUp ? 1 - ratio : ratio) * plotH;
  };

  let path = '';
  let open = false;
  for (const p of points) {
    if (p.y == null) { open = false; continue; }
    path += `${open ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)} `;
    open = true;
  }

  const yTicks = niceTicks(yMin, yMax, 4);
  const xTicks = niceTicks(xMin, xMax, 5);

  const cursorPoint = cursor != null ? real.reduce((best, p) => (Math.abs(p.x - cursor) < Math.abs(best.x - cursor) ? p : best), real[0]) : null;

  function onTouch(locationX: number) {
    const x = xMin + ((locationX - M.left) / plotW) * (xMax - xMin);
    setCursor(Math.min(Math.max(x, xMin), xMax));
  }

  return (
    <View style={{ gap: 6 }}>
      <Text style={{ fontSize: 12, fontWeight: '700', color: MUTED }}>{title}</Text>
      <Text style={{ fontSize: 12, color: cursorPoint ? '#0f172a' : '#94a3b8', minHeight: 16 }}>
        {cursorPoint
          ? `${xLabel === 'km' ? `km ${roundKm(cursorPoint.x)}` : `${Math.round(cursorPoint.x)} min`} · ${formatY(cursorPoint.y)} ${unit}`
          : 'Toque no gráfico para ver o valor em cada ponto'}
      </Text>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => onTouch(e.nativeEvent.locationX)}
        onResponderMove={(e) => onTouch(e.nativeEvent.locationX)}
      >
        <Svg width={width} height={HEIGHT}>
          {(bands ?? []).map((b, i) => {
            if (b.yFast == null || b.ySlow == null) return null;
            const top = Math.min(sy(b.yFast), sy(b.ySlow));
            const bottom = Math.max(sy(b.yFast), sy(b.ySlow));
            return (
              <React.Fragment key={`band-${i}`}>
                <Rect x={sx(b.from)} y={top} width={Math.max(sx(b.to) - sx(b.from), 1)} height={Math.max(bottom - top, 2)} fill="#f59e0b" opacity={0.22} />
                <SvgText x={sx(b.from) + 3} y={M.top + 9} fontSize={9} fill="#92400e">{b.label}</SvgText>
              </React.Fragment>
            );
          })}
          {yTicks.map((t) => (
            <React.Fragment key={`y-${t}`}>
              <Line x1={M.left} x2={M.left + plotW} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
              <SvgText x={M.left - 5} y={sy(t) + 3} fontSize={10} fill={MUTED} textAnchor="end">{formatY(t)}</SvgText>
            </React.Fragment>
          ))}
          {xTicks.map((t) => (
            <React.Fragment key={`x-${t}`}>
              <Line x1={sx(t)} x2={sx(t)} y1={M.top} y2={M.top + plotH} stroke={GRID} strokeWidth={1} />
              <SvgText x={sx(t)} y={HEIGHT - 8} fontSize={10} fill={MUTED} textAnchor="middle">{roundKm(t)}</SvgText>
            </React.Fragment>
          ))}
          <SvgText x={M.left + plotW} y={HEIGHT - 8} fontSize={9} fill={MUTED} textAnchor="end">{xLabel}</SvgText>
          {(boundaries ?? []).map((b) => (
            <Line key={`bd-${b}`} x1={sx(b)} x2={sx(b)} y1={M.top} y2={M.top + plotH} stroke="#92400e" strokeWidth={1} strokeDasharray="4,3" />
          ))}
          <Path d={path} stroke={BLUE} strokeWidth={1.6} fill="none" />
          {cursorPoint ? (
            <>
              <Line x1={sx(cursorPoint.x)} x2={sx(cursorPoint.x)} y1={M.top} y2={M.top + plotH} stroke="#0f172a" strokeWidth={1} opacity={0.5} />
              <Circle cx={sx(cursorPoint.x)} cy={sy(cursorPoint.y)} r={4} fill={BLUE} stroke="#fff" strokeWidth={1.5} />
            </>
          ) : null}
        </Svg>
      </View>
      <Text style={{ fontSize: 11, color: '#94a3b8' }}>{unit}{bands && bands.length ? ' · faixa laranja = ritmo prescrito' : ''}</Text>
    </View>
  );
}

function SplitsTable({ splits, segments }: { splits: ActivityDetailSplit[]; segments: ActivityDetailSegment[] }) {
  const header = (
    <View style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: GRID }}>
      {['Km', 'Tempo', 'Ritmo', 'FC', 'Cad.'].map((h, i) => (
        <Text key={h} style={{ flex: 1, fontSize: 11, fontWeight: '700', color: MUTED, textAlign: i === 0 ? 'left' : 'center' }}>{h}</Text>
      ))}
    </View>
  );
  const row = (split: ActivityDetailSplit) => (
    <View key={split.kmIndex} style={{ flexDirection: 'row', paddingVertical: 4, borderBottomWidth: 1, borderBottomColor: '#f1f5f9' }}>
      <Text style={{ flex: 1, fontSize: 13 }}>{split.isPartial ? `${split.distanceKm} km` : split.kmIndex}</Text>
      <Text style={{ flex: 1, fontSize: 13, textAlign: 'center' }}>{formatDurationSec(split.durationSec)}</Text>
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Text style={{ fontSize: 13 }}>{split.paceSecondsKm != null ? formatPace(split.paceSecondsKm) : '—'}</Text>
        {/* Pos-Bloco 1: pace prescrito explicito na propria parcial, lado a lado com o realizado acima. */}
        {split.prescribedPaceFastSecondsKm != null && split.prescribedPaceSlowSecondsKm != null ? (
          <Text style={{ fontSize: 10, color: MUTED }}>
            presc. {formatPace(split.prescribedPaceFastSecondsKm)}–{formatPace(split.prescribedPaceSlowSecondsKm)}
          </Text>
        ) : null}
      </View>
      <Text style={{ flex: 1, fontSize: 13, textAlign: 'center' }}>{split.avgHeartRateBpm ?? '—'}</Text>
      <Text style={{ flex: 1, fontSize: 13, textAlign: 'center' }}>{split.avgCadenceSpm ?? '—'}</Text>
    </View>
  );

  if (segments.length === 0) {
    return <View>{header}{splits.map(row)}</View>;
  }
  const outside = splits.filter((s) => s.segmentIndex == null);
  return (
    <View style={{ gap: 10 }}>
      {segments.map((seg) => {
        const own = splits.filter((s) => s.segmentIndex === seg.index);
        if (own.length === 0) return null;
        return (
          <View key={seg.index}>
            <Text style={{ fontSize: 13, fontWeight: '700' }}>{seg.label} · {seg.startKm}–{seg.endKm} km</Text>
            {seg.paceFastSecondsKm != null && seg.paceSlowSecondsKm != null ? (
              <Text style={{ fontSize: 12, color: MUTED }}>Prescrito: {formatPace(seg.paceFastSecondsKm)}–{formatPace(seg.paceSlowSecondsKm)}/km</Text>
            ) : null}
            {header}
            {own.map(row)}
          </View>
        );
      })}
      {outside.length > 0 ? (
        <View>
          <Text style={{ fontSize: 13, fontWeight: '700' }}>Após o previsto na prescrição</Text>
          {header}
          {outside.map(row)}
        </View>
      ) : null}
    </View>
  );
}

const sectionTitle = { fontSize: 12, fontWeight: '700' as const, color: MUTED };

export function ActivityDetailBody({ detail }: { detail: ActivityDetail }) {
  const s = detail.summary;
  const segments = detail.prescribedSegments ?? [];
  const byDistance = detail.chartAxis === 'distance' && detail.chart.every((p) => p.distanceMeters != null);
  const xOf = (p: ActivityDetailChartPoint) => (byDistance ? (p.distanceMeters as number) / 1000 : p.offsetSec / 60);
  const xLabel: 'km' | 'min' = byDistance ? 'km' : 'min';

  const pacePoints = detail.chart.map((p) => ({ x: xOf(p), y: p.speedKmh != null && p.speedKmh > 0 ? 3600 / p.speedKmh : null }));
  const hrPoints = detail.chart.map((p) => ({ x: xOf(p), y: p.heartRateBpm }));
  const cadPoints = detail.chart.map((p) => ({ x: xOf(p), y: p.cadenceSpm }));
  const hasData = (pts: Array<{ y: number | null }>) => pts.some((p) => p.y != null);

  // Faixas/limites de partes so' no eixo de distancia (km prescritos nao fazem sentido sobre tempo).
  const paceBands: ChartBand[] | undefined = byDistance
    ? segments.map((seg) => ({
        from: seg.startKm,
        to: seg.endKm,
        yFast: seg.paceFastSecondsKm,
        ySlow: seg.paceSlowSecondsKm,
        label: seg.paceFastSecondsKm != null && seg.paceSlowSecondsKm != null
          ? `${seg.label}: ${formatPace(seg.paceFastSecondsKm)}–${formatPace(seg.paceSlowSecondsKm)}`
          : seg.label,
      }))
    : undefined;
  const boundaries = byDistance ? segments.slice(1).map((seg) => seg.startKm) : undefined;

  return (
    <>
      {/* 1. Resumo */}
      <View style={{ gap: 4 }}>
        <Text style={{ fontSize: 13, color: MUTED }}>{new Date(detail.startedAt).toLocaleDateString('pt-BR')} · origem: {detail.provider}</Text>
        {s.distanceKm != null ? <Text style={{ fontSize: 15 }}>Distância: {roundKm(s.distanceKm)} km</Text> : null}
        {s.durationSec != null ? <Text style={{ fontSize: 15 }}>Duração: {formatDurationSec(s.durationSec)}</Text> : null}
        {s.avgPaceSecondsKm != null ? <Text style={{ fontSize: 15 }}>Ritmo médio: {formatPace(s.avgPaceSecondsKm)}/km</Text> : null}
        {s.avgHeartRateBpm != null ? <Text style={{ fontSize: 15 }}>FC média: {s.avgHeartRateBpm} bpm{s.maxHeartRateBpm != null ? ` (máx ${s.maxHeartRateBpm})` : ''}</Text> : null}
        {s.cadenceAvg != null ? <Text style={{ fontSize: 15 }}>Cadência média: {s.cadenceAvg} passos/min</Text> : null}
        {s.caloriesKcal != null ? <Text style={{ fontSize: 15 }}>Calorias: {s.caloriesKcal} kcal</Text> : null}
      </View>

      {/* 2. Prescrito x Realizado */}
      {detail.prescribed ? (
        <View style={{ gap: 4, padding: 12, borderRadius: 10, backgroundColor: '#f8fafc' }}>
          <Text style={sectionTitle}>PRESCRITO × REALIZADO</Text>
          <Text style={{ fontSize: 14 }}>Prescrito: {detail.prescribed.title}{detail.prescribed.distanceKm != null ? ` · ${detail.prescribed.distanceKm} km` : ''}</Text>
          <Text style={{ fontSize: 14 }}>Realizado: {s.distanceKm != null ? `${roundKm(s.distanceKm)} km` : 'indisponível'}{s.durationSec != null ? ` · ${formatDurationSec(s.durationSec)}` : ''}</Text>
          {/* Resumo deterministico pos-treino (ExecutionSummary) — so diferencas numericas. */}
          {detail.executionSummary?.distance.deltaKm != null ? (
            <Text style={{ fontSize: 13, color: MUTED }}>Diferença de distância: {formatDeltaKm(detail.executionSummary.distance.deltaKm)}</Text>
          ) : null}
          {detail.executionSummary?.duration.deltaSec != null ? (
            <Text style={{ fontSize: 13, color: MUTED }}>Diferença de duração: {detail.executionSummary.duration.deltaSec >= 0 ? '+' : '-'}{formatDurationSec(Math.abs(detail.executionSummary.duration.deltaSec))}</Text>
          ) : null}
          {segments.map((seg) => {
            const deltaSeg = detail.executionSummary?.segments.find((d) => d.index === seg.index) ?? null;
            return (
              <View key={seg.index} style={{ marginTop: 6 }}>
                <Text style={{ fontSize: 13, fontWeight: '700' }}>{seg.label} · {seg.startKm}–{seg.endKm} km</Text>
                {seg.paceFastSecondsKm != null && seg.paceSlowSecondsKm != null ? (
                  <Text style={{ fontSize: 13 }}>Prescrito: {formatPace(seg.paceFastSecondsKm)}–{formatPace(seg.paceSlowSecondsKm)}/km</Text>
                ) : null}
                {seg.realized ? (
                  <Text style={{ fontSize: 13 }}>
                    Realizado: {seg.realized.paceSecondsKm != null ? `${formatPace(seg.realized.paceSecondsKm)}/km` : '—'}
                    {seg.realized.avgHeartRateBpm != null ? ` · FC ${seg.realized.avgHeartRateBpm}` : ''}
                    {seg.realized.avgCadenceSpm != null ? ` · cad. ${seg.realized.avgCadenceSpm}` : ''}
                    {` · ${roundKm(seg.realized.distanceKm)} km`}
                  </Text>
                ) : null}
                {deltaSeg?.deltaPaceVsFastSecondsKm != null ? (
                  <Text style={{ fontSize: 12, color: MUTED }}>
                    Diferença vs. limite rápido: {formatDeltaSeconds(deltaSeg.deltaPaceVsFastSecondsKm)} · vs. limite lento: {deltaSeg.deltaPaceVsSlowSecondsKm != null ? formatDeltaSeconds(deltaSeg.deltaPaceVsSlowSecondsKm) : '—'}
                  </Text>
                ) : null}
              </View>
            );
          })}
          <Text style={{ fontSize: 12, color: MUTED }}>Diferença não é erro nem falta de aderência — é só o que aconteceu.</Text>
        </View>
      ) : null}

      {/* 3-5. Ritmo, FC, Cadência — so' quando ha' dado */}
      {hasData(pacePoints) ? (
        <DetailChart
          title="RITMO"
          unit="min/km (mais rápido no alto)"
          points={pacePoints}
          xLabel={xLabel}
          formatY={(v) => formatPace(v)}
          higherIsUp={false}
          bands={paceBands}
          boundaries={boundaries}
        />
      ) : null}
      {hasData(hrPoints) ? (
        <DetailChart title="FREQUÊNCIA CARDÍACA" unit="bpm" points={hrPoints} xLabel={xLabel} formatY={(v) => `${Math.round(v)}`} higherIsUp boundaries={boundaries} />
      ) : null}
      {hasData(cadPoints) ? (
        <DetailChart title="CADÊNCIA" unit="passos/min" points={cadPoints} xLabel={xLabel} formatY={(v) => `${Math.round(v)}`} higherIsUp boundaries={boundaries} />
      ) : null}

      {/* 6. Parciais (derivadas pelo Panzeri Run), agrupadas pelas partes prescritas quando ha' */}
      {detail.splits.length > 0 ? (
        <View style={{ gap: 6 }}>
          <Text style={sectionTitle}>PARCIAIS</Text>
          <SplitsTable splits={detail.splits} segments={segments} />
        </View>
      ) : null}
    </>
  );
}
