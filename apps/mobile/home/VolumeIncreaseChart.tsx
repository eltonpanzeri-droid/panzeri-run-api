import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth } from './homeApi';
import { IndicatorMeaning } from './IndicatorMeaning';

// Aumento semanal do volume REALIZADO (15/11/2026, pedido de Elton): cada barra é a variação % da semana sobre a anterior (semanas fechadas). Verde = aumento mais seguro (ou redução),
// amarelo = atenção, vermelho = aumento maior. A faixa de cada barra e a legenda vêm do servidor (GET /me/evolution/volume-increase): o app só pinta.
type Band = 'safe' | 'attention' | 'high';
interface Bar { weekStart: string; km: number; pct: number | null; band: Band | null }
interface Payload { bars: Bar[]; legend: Array<{ band: Band; label: string }> }

const BAND_COLOR: Record<Band, string> = { safe: '#16A34A', attention: '#F59E0B', high: '#DC2626' };
const CHART_HEIGHT = 150;
const MAX_PCT = 60; // acima disso a barra só fica no teto (o número continua escrito)

const dm = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
const pctText = (pct: number) => `${pct > 0 ? '+' : ''}${Math.round(pct)}%`;

export function VolumeIncreaseChart({ accessToken }: { accessToken: string }) {
  const [data, setData] = useState<Payload | null | undefined>(undefined);
  useEffect(() => {
    let alive = true;
    fetchJsonAuth<Payload>('/me/evolution/volume-increase', accessToken).then((d) => { if (alive) setData(d); });
    return () => { alive = false; };
  }, [accessToken]);

  if (data === undefined) return <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />;
  const bars = (data?.bars ?? []).filter((bar) => bar.pct != null);
  const half = CHART_HEIGHT / 2;

  return (
    <View style={[styles.block, HomeBorder.card]}>
      <Text style={styles.title}>Aumento semanal do volume (km realizados)</Text>
      {bars.length < 2 ? (
        <Text style={styles.empty}>Ainda não há semanas completas suficientes para mostrar o aumento semanal.</Text>
      ) : (
        <>
          <View style={styles.legend}>
            {(data?.legend ?? []).map((item) => (
              <View key={item.band} style={styles.legendItem}>
                <View style={[styles.dot, { backgroundColor: BAND_COLOR[item.band] }]} />
                <Text style={styles.legendText}>{item.label}</Text>
              </View>
            ))}
          </View>
          <View style={styles.chart}>
            <View style={[styles.baseline, { top: half }]} />
            {bars.map((bar) => {
              const pct = bar.pct as number;
              const size = Math.max(3, (Math.min(Math.abs(pct), MAX_PCT) / MAX_PCT) * (half - 16));
              const color = bar.band ? BAND_COLOR[bar.band] : '#94A3B8';
              return (
                <View key={bar.weekStart} style={styles.column}>
                  <View style={{ position: 'absolute', left: 0, right: 0, top: pct >= 0 ? half - size - 14 : half + size + 1, alignItems: 'center' }}>
                    <Text style={[styles.value, { color }]}>{pctText(pct)}</Text>
                  </View>
                  <View style={{ position: 'absolute', left: 4, right: 4, top: pct >= 0 ? half - size : half, height: size, backgroundColor: color, borderRadius: 3 }} />
                </View>
              );
            })}
          </View>
          <View style={styles.dates}>
            {bars.map((bar) => <Text key={bar.weekStart} style={styles.date}>{dm(bar.weekStart)}</Text>)}
          </View>
          <Text style={styles.legendText}>Cada barra é uma semana completa; a data é o início da semana.</Text>
        </>
      )}
      <IndicatorMeaning id="training.volumeIncreasePct" />
    </View>
  );
}

const styles = StyleSheet.create({
  block: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 10 },
  title: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  empty: { ...HomeTypography.body, color: HomeColors.textSecondary },
  legend: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  dot: { width: 10, height: 10, borderRadius: 5 },
  legendText: { fontSize: 11, color: '#64748B' },
  chart: { flexDirection: 'row', height: CHART_HEIGHT },
  baseline: { position: 'absolute', left: 0, right: 0, height: 1, backgroundColor: '#CBD5E1' },
  column: { flex: 1, height: CHART_HEIGHT },
  value: { fontSize: 10, fontWeight: '800' },
  dates: { flexDirection: 'row' },
  date: { flex: 1, textAlign: 'center', fontSize: 9, color: '#64748B' },
});
