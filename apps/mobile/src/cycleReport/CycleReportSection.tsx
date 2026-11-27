import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';

// Relatório do ciclo por fase (19/11/2026, ordem de Elton). A aluna PEDE o relatório mensal (um por mês); o servidor calcula os números por fase e o Agente da Mulher escreve o resumo. Esta tela só mostra.
interface Stat { n: number; mean: number | null }
interface Metric { id: string; label: string; unit: string; perPhase: Record<string, Stat> }
interface PhaseBlock { id: string; label: string; daysObserved: number; workouts: { done: number; missed: number; adherencePct: number | null; km: number }; pain: { workoutsWithPain: number; meanLevel: number | null; standaloneReports: number; standaloneMeanIntensity: number | null } }
interface Report { version: number; window: { from: string; to: string }; cyclesCount: number; limitations: string[]; phases: PhaseBlock[]; highlights: Metric[]; otherIndicators: Metric[]; quadroGeral: string[] }
interface ReportResponse { id: string; monthKey: string; createdAt: string; narrative: string | null; report: Report; alreadyGenerated?: boolean }
interface ListResponse { canRequest: boolean; thisMonthReportId: string | null; reports: Array<{ id: string; monthKey: string; createdAt: string }> }

const PHASES = ['menstruacao', 'folicular', 'ovulatoria', 'lutea'];
const fmt = (stat: Stat | undefined, unit: string) => (stat && stat.n > 0 && stat.mean != null ? `${String(stat.mean).replace('.', ',')}${unit}` : '—');
const phaseShort = (id: string) => ({ menstruacao: 'Menstrual', folicular: 'Folicular', ovulatoria: 'Ovulatória', lutea: 'Lútea' } as Record<string, string>)[id] ?? id;
function paceText(stat: Stat | undefined): string {
  if (!stat || stat.n === 0 || stat.mean == null) return '—';
  const total = Math.round(stat.mean);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}/km`;
}

export function CycleReportSection({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const [list, setList] = useState<ListResponse | null>(null);
  const [current, setCurrent] = useState<ReportResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [showOthers, setShowOthers] = useState(false);
  const [message, setMessage] = useState('');

  const open = useCallback(async (id: string) => {
    try {
      const res = await fetch(`${apiUrl}/menstrual-cycle/reports/${id}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) setCurrent((await res.json()) as ReportResponse);
    } catch { setMessage('Não consegui abrir o relatório agora.'); }
  }, [apiUrl, accessToken]);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${apiUrl}/menstrual-cycle/reports`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error('status');
      const body = (await res.json()) as ListResponse;
      setList(body);
      if (body.reports[0]) void open(body.reports[0].id);
    } catch { setMessage('Não consegui carregar seus relatórios agora.'); }
  }, [apiUrl, accessToken, open]);
  useEffect(() => { void load(); }, [load]);

  async function request() {
    if (busy) return;
    setBusy(true); setMessage('');
    try {
      const res = await fetch(`${apiUrl}/menstrual-cycle/reports/request`, { method: 'POST', headers: { Authorization: `Bearer ${accessToken}` } });
      const body = await res.json().catch(() => null);
      if (!res.ok) { setMessage(body?.message ?? 'Não consegui gerar o relatório agora. Tente de novo em instantes.'); return; }
      setCurrent(body as ReportResponse);
      setList((previous) => (previous ? { ...previous, canRequest: false, thisMonthReportId: (body as ReportResponse).id } : previous));
    } catch { setMessage('Não consegui gerar o relatório agora. Tente de novo em instantes.'); }
    finally { setBusy(false); }
  }

  const report = current?.report;
  const blocked = busy || list?.canRequest === false;
  return (
    <View style={styles.box}>
      <Text style={styles.title}>Relatório do seu ciclo</Text>
      <Text style={styles.hint}>Mostra como você se comportou em cada fase do ciclo: esforço, treinos, dor, ritmo, sono e outros indicadores. Você pode pedir um relatório por mês, para dar tempo de o ciclo passar.</Text>
      <Pressable onPress={() => void request()} disabled={blocked} accessibilityRole="button" style={[styles.button, blocked && { opacity: 0.5 }]}>
        {busy ? <ActivityIndicator color="#ffffff" /> : <Text style={styles.buttonText}>{list?.canRequest === false ? 'Você já pediu o relatório deste mês' : 'Pedir relatório mensal'}</Text>}
      </Pressable>
      {busy ? <Text style={styles.hint}>Gerando o seu relatório. Isso pode levar um minuto.</Text> : null}
      {message ? <Text style={[styles.hint, { color: '#b91c1c' }]}>{message}</Text> : null}

      {report && current ? (
        <View style={{ gap: 12, marginTop: 6 }}>
          <Text style={styles.sub}>Relatório de {current.monthKey.slice(5)}/{current.monthKey.slice(0, 4)} · período de {report.window.from.split('-').reverse().join('/')} a {report.window.to.split('-').reverse().join('/')}</Text>
          {current.narrative ? <Text style={styles.body}>{current.narrative}</Text> : <Text style={styles.hint}>O resumo escrito não foi gerado neste relatório (precisa do seu aceite do ciclo para a IA, em Ciclo). Os números abaixo estão completos.</Text>}
          {report.quadroGeral.length ? (
            <View style={styles.card}>
              <Text style={styles.sub}>Quadro geral</Text>
              {report.quadroGeral.map((line, index) => <Text key={index} style={styles.body}>• {line}</Text>)}
            </View>
          ) : null}
          {report.phases.map((phase) => (
            <View key={phase.id} style={styles.card}>
              <Text style={styles.sub}>{phase.label}</Text>
              <Text style={styles.hint}>{phase.daysObserved} dia(s) observados</Text>
              <Text style={styles.body}>Treinos feitos: {phase.workouts.done} · Não feitos: {phase.workouts.missed} · Aderência: {phase.workouts.adherencePct == null ? '—' : `${phase.workouts.adherencePct}%`}</Text>
              <Text style={styles.body}>Km rodados: {String(phase.workouts.km).replace('.', ',')}</Text>
              <Text style={styles.body}>Treinos com dor: {phase.pain.workoutsWithPain}{phase.pain.meanLevel != null ? ` (nota média ${String(phase.pain.meanLevel).replace('.', ',')} de 10)` : ''}</Text>
              <Text style={styles.body}>Relatos avulsos de dor: {phase.pain.standaloneReports}{phase.pain.standaloneMeanIntensity != null ? ` (intensidade média ${String(phase.pain.standaloneMeanIntensity).replace('.', ',')})` : ''}</Text>
              {report.highlights.map((metric) => (
                <Text key={metric.id} style={styles.body}>{metric.label}: {metric.id === 'activity.avgPaceSecondsKm' ? paceText(metric.perPhase[phase.id]) : fmt(metric.perPhase[phase.id], metric.unit)}</Text>
              ))}
            </View>
          ))}
          {report.otherIndicators.length ? (
            <View style={styles.card}>
              <Pressable onPress={() => setShowOthers((value) => !value)} accessibilityRole="button"><Text style={[styles.sub, { color: PRColors.ocean }]}>{showOthers ? 'Esconder' : 'Ver'} os outros indicadores da Evolução por fase</Text></Pressable>
              {showOthers ? report.otherIndicators.map((metric) => (
                <Text key={metric.id} style={styles.body}>{metric.label}: {PHASES.map((phase) => `${phaseShort(phase)} ${fmt(metric.perPhase[phase], metric.unit)}`).join(' · ')}</Text>
              )) : null}
            </View>
          ) : null}
          <View style={styles.card}>
            <Text style={styles.sub}>Limitações</Text>
            {report.limitations.map((line, index) => <Text key={index} style={styles.hint}>• {line}</Text>)}
          </View>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  box: { gap: 10, padding: 16, borderRadius: 14, backgroundColor: '#ffffff', borderWidth: 1, borderColor: '#e2e8f0', marginTop: 16 },
  title: { fontSize: 18, fontWeight: '800', color: '#0f172a' },
  sub: { fontSize: 14, fontWeight: '800', color: '#0f172a' },
  hint: { fontSize: 12, color: '#475569' },
  body: { fontSize: 13, color: '#1e293b' },
  card: { gap: 4, padding: 12, borderRadius: 10, backgroundColor: '#f8fafc', borderWidth: 1, borderColor: '#e2e8f0' },
  button: { paddingVertical: 12, borderRadius: 10, alignItems: 'center', backgroundColor: PRColors.ocean },
  buttonText: { color: '#ffffff', fontWeight: '800' },
});
