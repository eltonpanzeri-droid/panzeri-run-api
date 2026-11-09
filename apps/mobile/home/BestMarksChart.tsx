import React, { useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { Text } from '../src/PtText';
import { HomeColors, HomeTypography } from './homeTheme';
import { MarkChartPoint, formatMarkDate, formatMarkTime } from './bestMarks';

// Evolucao das marcas de UMA distancia (09/11/2026): cada treino que alcancou a distancia e' um ponto; a linha em degraus mostra a melhor marca ate cada data; os pontos grandes sao as
// "marcas batidas". Mais rapido fica em CIMA. Toque/arraste escolhe o ponto; a tela de cima mostra o detalhe e abre o treino. Somente leitura.

const HEIGHT = 190;
const M = { left: 52, right: 14, top: 14, bottom: 26 };
const DAY_LABEL = (day: number) => {
  const iso = new Date(day * 86_400_000).toISOString();
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};

export function BestMarksChart({ points, selectedKey, onSelect }: { points: MarkChartPoint[]; selectedKey: string | null; onSelect: (key: string) => void }) {
  const [width, setWidth] = useState(320);

  const scale = useMemo(() => {
    const days = points.map((p) => p.day);
    const secs = points.map((p) => p.seconds);
    let xMin = Math.min(...days);
    let xMax = Math.max(...days);
    if (xMax === xMin) { xMin -= 3; xMax += 3; }
    let yMin = Math.min(...secs);
    let yMax = Math.max(...secs);
    if (yMax === yMin) { yMin -= 30; yMax += 30; }
    const pad = (yMax - yMin) * 0.12;
    return { xMin, xMax, yMin: yMin - pad, yMax: yMax + pad };
  }, [points]);

  const plotW = Math.max(width - M.left - M.right, 10);
  const plotH = HEIGHT - M.top - M.bottom;
  const sx = (day: number) => M.left + ((day - scale.xMin) / (scale.xMax - scale.xMin)) * plotW;
  const sy = (seconds: number) => M.top + ((seconds - scale.yMin) / (scale.yMax - scale.yMin)) * plotH; // menor tempo = mais alto

  const stairs = useMemo(() => {
    const records = points.filter((p) => p.isRecord);
    if (records.length === 0) return '';
    let d = '';
    records.forEach((p, i) => {
      const x = sx(p.day);
      const y = sy(p.seconds);
      d += i === 0 ? `M ${x} ${y}` : ` L ${x} ${sy(records[i - 1].seconds)} L ${x} ${y}`;
    });
    d += ` L ${M.left + plotW} ${sy(records[records.length - 1].seconds)}`;
    return d;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [points, scale, width]);

  function onTouch(x: number) {
    let best: MarkChartPoint | null = null;
    let bestDistance = Infinity;
    for (const p of points) {
      const distance = Math.abs(sx(p.day) - x);
      if (distance < bestDistance) { best = p; bestDistance = distance; }
    }
    if (best) onSelect(best.key);
  }

  const yTicks = [scale.yMin, (scale.yMin + scale.yMax) / 2, scale.yMax];
  const xTicks = [scale.xMin, (scale.xMin + scale.xMax) / 2, scale.xMax];
  const selected = points.find((p) => p.key === selectedKey) ?? null;

  return (
    <View style={{ gap: 6 }}>
      <View
        onLayout={(e) => setWidth(e.nativeEvent.layout.width)}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderGrant={(e) => onTouch(e.nativeEvent.locationX)}
        onResponderMove={(e) => onTouch(e.nativeEvent.locationX)}
      >
        <Svg width={width} height={HEIGHT}>
          {yTicks.map((tick, i) => (
            <React.Fragment key={i}>
              <Line x1={M.left} x2={M.left + plotW} y1={sy(tick)} y2={sy(tick)} stroke={HomeColors.divider} strokeWidth={1} />
              <SvgText x={M.left - 6} y={sy(tick) + 3} fontSize={10} fill={HomeColors.textTertiary} textAnchor="end">{formatMarkTime(tick)}</SvgText>
            </React.Fragment>
          ))}
          {xTicks.map((tick, i) => (
            <SvgText key={i} x={sx(tick)} y={HEIGHT - 8} fontSize={10} fill={HomeColors.textTertiary} textAnchor={i === 0 ? 'start' : i === 2 ? 'end' : 'middle'}>{DAY_LABEL(Math.round(tick))}</SvgText>
          ))}
          {stairs ? <Path d={stairs} stroke={HomeColors.panzeriAccent} strokeWidth={2} fill="none" opacity={0.55} /> : null}
          {points.map((p) => (p.isRecord
            ? <Circle key={p.key} cx={sx(p.day)} cy={sy(p.seconds)} r={6} fill={HomeColors.panzeriInteraction} stroke="#fff" strokeWidth={2} />
            : <Circle key={p.key} cx={sx(p.day)} cy={sy(p.seconds)} r={4} fill="#fff" stroke={HomeColors.textTertiary} strokeWidth={1.5} />))}
          {selected ? <Circle cx={sx(selected.day)} cy={sy(selected.seconds)} r={11} fill="none" stroke={HomeColors.panzeriPrimary} strokeWidth={2} /> : null}
        </Svg>
      </View>
      <View style={styles.legend}>
        <View style={styles.legendItem}><View style={[styles.dot, { backgroundColor: HomeColors.panzeriInteraction }]} /><Text style={styles.legendText}>marca batida</Text></View>
        <View style={styles.legendItem}><View style={[styles.dot, styles.dotHollow]} /><Text style={styles.legendText}>outro treino na distância</Text></View>
      </View>
      {selected ? <Text style={styles.selected}>{formatMarkDate(selected.mark.startedAt)} · {formatMarkTime(selected.seconds)}{selected.isRecord ? ' · marca batida' : ''}</Text> : <Text style={styles.hint}>Toque no gráfico para ver cada treino</Text>}
    </View>
  );
}

const styles = StyleSheet.create({
  legend: { flexDirection: 'row', gap: 16, flexWrap: 'wrap' },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  dotHollow: { backgroundColor: '#fff', borderWidth: 1.5, borderColor: HomeColors.textTertiary },
  legendText: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  selected: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  hint: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
});
