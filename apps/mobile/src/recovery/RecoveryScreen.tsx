import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { InfoTip } from '../InfoTip';

// "Minha recuperação" (30/10/2026): o aluno vê os próprios dados de recuperação e saúde que autorizou compartilhar, de onde vêm e por que o Panzeri Run os usa. Só leitura. Mostra o que existe: sem
// dado, o indicador não aparece e a tela explica como conectar (nada é estimado nem preenchido com zero).

type Point = { date: string; value: number };
type Indicator = { id: string; label: string; unit: string; why: string; source: string; note: string | null; days: number; lastDate: string; last: number; avg7: number | null; avg30: number; points: Point[] };
type Summary = { periodDays: number; indicators: Indicator[]; empty: boolean };

const fmtDate = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
function fmtValue(indicator: Indicator, value: number): string {
  if (indicator.id === 'sleep') { const h = Math.floor(value / 60); const m = Math.round(value % 60); return `${h} h ${String(m).padStart(2, '0')} min`; }
  const text = Number.isInteger(value) ? String(value) : value.toFixed(1).replace('.', ',');
  return `${text} ${indicator.unit}`;
}

function Bars({ points }: { points: Point[] }) {
  const max = Math.max(...points.map((p) => p.value), 1);
  return (
    <View style={styles.bars} accessibilityLabel="Gráfico dos últimos dias">
      {points.slice(-30).map((p) => <View key={p.date} style={[styles.bar, { height: Math.max(3, Math.round((p.value / max) * 36)) }]} />)}
    </View>
  );
}

export function RecoveryScreen({ accessToken, apiUrl, onBack, onOpenIntegrations }: { accessToken: string; apiUrl: string; onBack?: () => void; onOpenIntegrations?: () => void }) {
  const [data, setData] = useState<Summary | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch(`${apiUrl}/me/recovery-summary`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('http');
      setData((await response.json()) as Summary);
      setState('ready');
    } catch {
      setState('error');
    }
  }, [apiUrl, accessToken]);

  useEffect(() => { void load(); }, [load]);

  return (
    <View style={styles.wrap}>
      {onBack ? <Pressable onPress={onBack} accessibilityRole="button"><Text style={styles.back}>← Voltar</Text></Pressable> : null}
      <Text style={styles.title}>Minha recuperação</Text>
      <Text style={styles.intro}>Aqui você vê os dados de saúde e recuperação que escolheu compartilhar com o Panzeri Run, de onde vêm e por que usamos cada um para ajustar o seu treino. Você controla o que compartilha em Dispositivos e integrações.</Text>
      <InfoTip label="Como esses dados são usados?">{'Seu treinador e a inteligência artificial do Panzeri Run usam esses dados, sempre comparando você com você mesmo, para decidir se a carga da semana deve subir, ser mantida ou aliviada. Eles não substituem avaliação médica, não são vendidos e não são usados para publicidade. Você pode retirar o compartilhamento a qualquer momento, e os dados daquele grupo deixam de ser usados.'}</InfoTip>

      {state === 'loading' ? <ActivityIndicator style={{ marginTop: 16 }} /> : null}
      {state === 'error' ? (
        <View style={styles.box}>
          <Text style={styles.problem}>Não foi possível carregar seus dados agora.</Text>
          <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button"><Text style={styles.buttonText}>Tentar de novo</Text></Pressable>
        </View>
      ) : null}

      {state === 'ready' && data?.empty ? (
        <View style={styles.box}>
          <Text style={styles.boxTitle}>Ainda não há dados de recuperação</Text>
          <Text style={styles.hint}>Para ver aqui o seu sono, a variabilidade da frequência cardíaca, a frequência cardíaca de repouso, os passos e outros indicadores, conecte o Health Connect (Android) ou o app Saúde (iPhone) em Dispositivos e integrações, escolha o que compartilhar e sincronize. Só aparece o que o seu relógio ou aplicativo realmente registrou.</Text>
          {onOpenIntegrations ? <Pressable style={styles.button} onPress={onOpenIntegrations} accessibilityRole="button"><Text style={styles.buttonText}>Abrir Dispositivos e integrações</Text></Pressable> : null}
        </View>
      ) : null}

      {state === 'ready' ? data?.indicators.map((indicator) => (
        <View key={indicator.id} style={styles.card}>
          <Text style={styles.label}>{indicator.label}</Text>
          <Text style={styles.value}>{fmtValue(indicator, indicator.last)}</Text>
          <Text style={styles.hint}>Último registro em {fmtDate(indicator.lastDate)} · fonte: {indicator.source}</Text>
          <Text style={styles.hint}>
            {indicator.avg7 !== null ? `Média de 7 dias: ${fmtValue(indicator, indicator.avg7)} · ` : ''}Média de {data.periodDays} dias: {fmtValue(indicator, indicator.avg30)} · {indicator.days} {indicator.days === 1 ? 'dia' : 'dias'} com registro
          </Text>
          {indicator.points.length > 1 ? <Bars points={indicator.points} /> : null}
          <InfoTip label="Por que usamos este dado?">{indicator.why}</InfoTip>
          {indicator.note ? <Text style={styles.note}>{indicator.note}</Text> : null}
        </View>
      )) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 12, paddingBottom: 24 },
  back: { fontSize: 14, color: '#246F91', fontWeight: '600' },
  title: { fontSize: 22, fontWeight: '800', color: '#071827' },
  intro: { fontSize: 13, color: '#4a5560', lineHeight: 19 },
  box: { padding: 14, borderWidth: 1, borderColor: '#d6dee6', borderRadius: 10, gap: 8 },
  boxTitle: { fontSize: 15, fontWeight: '700', color: '#071827' },
  card: { padding: 14, borderWidth: 1, borderColor: '#d6dee6', borderRadius: 10, gap: 6, backgroundColor: '#fff' },
  label: { fontSize: 13, fontWeight: '700', color: '#4a5560' },
  value: { fontSize: 24, fontWeight: '800', color: '#071827' },
  hint: { fontSize: 12, color: '#4a5560', lineHeight: 17 },
  note: { fontSize: 11, color: '#6b7783', lineHeight: 16 },
  problem: { fontSize: 13, color: '#b91c1c' },
  button: { alignItems: 'center', paddingVertical: 12, borderRadius: 8, borderWidth: 1, borderColor: '#246F91' },
  buttonText: { fontSize: 14, fontWeight: '700', color: '#246F91' },
  bars: { flexDirection: 'row', alignItems: 'flex-end', gap: 2, height: 40, marginTop: 4 },
  bar: { flex: 1, backgroundColor: '#8fc3d9', borderRadius: 2 },
});
