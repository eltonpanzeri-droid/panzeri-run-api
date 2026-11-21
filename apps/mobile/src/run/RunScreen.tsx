import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Switch, View } from 'react-native';
import { Text } from '../PtText';
import { RecordedPoint, RunSnapshot, RunState, snapshotOf } from './engine';
import { bestEfforts, gpsQuality, kilometerSplits } from './analysis';
import { formatDuration, formatPace } from './track';
import { ExecutableStep, WorkoutDefinition, compileWorkout, formatMinuteSecond } from './workout';
import { StoredRunStructure, structureToWorkout } from './prescription';
import { RunSettings, TrackingMode, beginRun, discardRun, finishCurrent, findInterruptedRun, loadRunSettings, pauseCurrent, resumeCurrent, resumeInterrupted, runStorage, saveRunSettings, subscribeRun } from './tracking';
import { UploadOutcome, uploadAllPending, uploadRun } from './upload';
import { RunConsentCard } from './RunConsentCard';

// Tela do INICIAR TREINO (21/11/2026, decisao de Elton): a aluna toca em "Iniciar treino" na prescricao (ou comeca um treino livre), corre guiada e o resultado volta ao Panzeri Run. A IA prescreve; esta tela so'
// executa e mede. A comparacao prescrito x realizado compara o medido com o que a prescricao pediu (sem julgamento). Localizacao so' durante o treino. A tela depende do aparelho (GPS) e deve ser validada no iPhone.

export type RunSessionInput = { id: string; title: string; structure: StoredRunStructure } | null;

type Stage = 'loading' | 'consent' | 'ready' | 'recording' | 'summary';
type Summary = { state: RunState; points: RecordedPoint[] };

const secToPace = (sec: number | null) => (sec === null || !Number.isFinite(sec) ? '--:--' : `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`);
const km = (m: number) => (m / 1000).toFixed(2).replace('.', ',');

function stepLabel(step: ExecutableStep): string {
  const size = step.completion.kind === 'distance' ? `${km(step.completion.meters)} km` : step.completion.kind === 'duration' ? formatMinuteSecond(step.completion.seconds) : 'livre';
  const pace = step.targets.find((target) => target.metric === 'pace');
  return `${step.name} · ${size}${pace && pace.metric === 'pace' ? ` · ${secToPace(pace.minSecPerKm)} a ${secToPace(pace.maxSecPerKm)}/km` : ''}`;
}

export function RunScreen({ apiUrl, accessToken, session, onClose }: { apiUrl: string; accessToken: string; session: RunSessionInput; onClose: () => void }) {
  const [stage, setStage] = useState<Stage>('loading');
  const [settings, setSettings] = useState<RunSettings>({ voice: true, vibration: true });
  const [interrupted, setInterrupted] = useState<RunState | null>(null);
  const [mode, setMode] = useState<TrackingMode | null>(null);
  const [snapshot, setSnapshot] = useState<RunSnapshot | null>(null);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [upload, setUpload] = useState<UploadOutcome | 'sending' | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const stateRef = useRef<RunState | null>(null);

  const workout: WorkoutDefinition | null = session ? structureToWorkout({ id: session.id, title: session.title, structure: session.structure }) : null;
  const program: ExecutableStep[] = workout ? compileWorkout(workout) : [];

  const refreshSnapshot = useCallback(() => { if (stateRef.current) setSnapshot(snapshotOf(stateRef.current, Date.now())); }, []);

  const checkConsent = useCallback(async (): Promise<boolean> => {
    try {
      const response = await fetch(`${apiUrl}/me/run/consent`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) return false;
      const data = (await response.json()) as { consent?: { needsReview?: boolean }; groups?: Array<{ id: string; granted: boolean }> };
      return Boolean(data.groups?.some((group) => group.id === 'activity' && group.granted)) && !data.consent?.needsReview;
    } catch {
      return false;
    }
  }, [accessToken, apiUrl]);

  // abertura: configuracoes, treino interrompido, autorizacao e reenvio dos treinos que ficaram pendentes
  useEffect(() => {
    let alive = true;
    void (async () => {
      const [loaded, found, consented] = await Promise.all([loadRunSettings(), findInterruptedRun(), checkConsent()]);
      if (!alive) return;
      setSettings(loaded);
      if (found) { stateRef.current = found; setInterrupted(found); }
      setStage(consented ? 'ready' : 'consent');
      if (consented) void uploadAllPending({ apiUrl, accessToken, storage: runStorage });
    })();
    return () => { alive = false; };
  }, [accessToken, apiUrl, checkConsent]);

  // acompanha o treino: mudancas do motor + um relogio de 1 s para o cronometro
  useEffect(() => {
    if (stage !== 'recording') return undefined;
    const unsubscribe = subscribeRun((state) => { stateRef.current = state; setSnapshot(snapshotOf(state, Date.now())); });
    const timer = setInterval(refreshSnapshot, 1000);
    refreshSnapshot();
    return () => { unsubscribe(); clearInterval(timer); };
  }, [stage, refreshSnapshot]);

  const onConsentChange = useCallback((granted: { activity: boolean; needsReview: boolean }) => {
    if (granted.activity && !granted.needsReview) setStage((current) => (current === 'consent' ? 'ready' : current));
  }, []);

  const changeSettings = (patch: Partial<RunSettings>) => {
    const next = { ...settings, ...patch };
    setSettings(next);
    void saveRunSettings(next);
  };

  const start = async () => {
    if (busy) return;
    setBusy(true); setMessage(null);
    try {
      const result = await beginRun({ program, prescribedSessionId: session?.id ?? null });
      if ('error' in result) {
        setMessage(result.error === 'permission_denied' ? 'Para gravar o treino, permita a localização para o Panzeri Run nos Ajustes do celular.' : 'Já existe um treino em andamento.');
        return;
      }
      stateRef.current = result.state; setMode(result.mode); setStage('recording');
    } catch {
      setMessage('Não consegui iniciar o GPS agora. Tente de novo.');
    } finally { setBusy(false); }
  };

  const resumeAfterClose = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const result = await resumeInterrupted();
      if (!result) { setMessage('Não encontrei o treino para retomar.'); return; }
      stateRef.current = result.state; setMode(result.mode); setInterrupted(null); setStage('recording');
    } catch { setMessage('Não consegui retomar o GPS agora.'); } finally { setBusy(false); }
  };

  const sendNow = useCallback(async (runId: string) => {
    setUpload('sending');
    const outcome = await uploadRun({ apiUrl, accessToken, runId, storage: runStorage });
    setUpload(outcome);
  }, [accessToken, apiUrl]);

  const finish = () => {
    Alert.alert('Encerrar o treino?', 'O treino será encerrado e guardado.', [
      { text: 'Continuar treinando', style: 'cancel' },
      {
        text: 'Encerrar',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            const done = await finishCurrent();
            if (!done) { setMessage('Não consegui encerrar o treino.'); return; }
            setSummary(done); setStage('summary');
            void sendNow(done.state.runId);
          })();
        },
      },
    ]);
  };

  const finishInterrupted = async () => {
    // Encerrar um treino interrompido: usa o que ja' foi gravado
    if (!interrupted) return;
    setBusy(true);
    try {
      const resumed = await resumeInterrupted();
      if (!resumed) return;
      const done = await finishCurrent();
      if (done) { setInterrupted(null); setSummary(done); setStage('summary'); void sendNow(done.state.runId); }
    } finally { setBusy(false); }
  };

  const discardInterrupted = () => {
    if (!interrupted) return;
    Alert.alert('Descartar o treino?', 'O que foi gravado será apagado do celular e não será enviado.', [
      { text: 'Voltar', style: 'cancel' },
      { text: 'Descartar', style: 'destructive', onPress: () => { void discardRun(interrupted.runId).then(() => setInterrupted(null)); } },
    ]);
  };

  const closeSummary = () => {
    // tira o treino do aparelho so' depois de enviado; se nao foi, fica guardado e sera reenviado
    if (summary && upload === 'sent') void runStorage.clear(summary.state.runId);
    onClose();
  };

  if (stage === 'loading') return <View style={styles.center}><ActivityIndicator /></View>;

  if (stage === 'consent') {
    return (
      <ScrollView contentContainerStyle={styles.page}>
        <Text style={styles.h1}>Iniciar treino</Text>
        <Text style={styles.text}>Antes do primeiro treino gravado no Panzeri Run, escolha o que você autoriza.</Text>
        <RunConsentCard accessToken={accessToken} apiUrl={apiUrl} onChange={onConsentChange} />
        <Pressable style={styles.secondary} onPress={onClose}><Text style={styles.secondaryText}>Voltar</Text></Pressable>
      </ScrollView>
    );
  }

  if (stage === 'recording' && snapshot) {
    const paused = snapshot.phase === 'paused';
    const zoneColor = snapshot.zone === 'in-zone' ? '#15803D' : snapshot.zone === 'unavailable' ? '#475569' : '#B45309';
    const step = snapshot.step;
    const target = step?.targets.find((t) => t.metric === 'pace');
    return (
      <ScrollView contentContainerStyle={styles.page}>
        {mode === 'foreground' ? <Text style={styles.warn}>Gravando só com a tela ligada. Para gravar com a tela bloqueada, permita a localização “Sempre” para o Panzeri Run nos Ajustes do celular.</Text> : null}
        <Text style={styles.phase}>{paused ? 'PAUSADO' : 'GRAVANDO'}</Text>
        <Text style={styles.clock}>{formatDuration(snapshot.timerMs)}</Text>
        {step ? (
          <View style={[styles.stepCard, { borderColor: zoneColor }]}>
            <Text style={styles.stepName}>{step.name.toUpperCase()} · {snapshot.stepIndex + 1}/{snapshot.stepCount}</Text>
            <Text style={styles.stepMain}>
              {snapshot.stepRemainingM !== null ? `FALTAM ${Math.ceil(snapshot.stepRemainingM)} m` : snapshot.stepRemainingMs !== null ? `FALTAM ${formatDuration(snapshot.stepRemainingMs)}` : 'ETAPA LIVRE'}
            </Text>
            {target && target.metric === 'pace' ? <Text style={[styles.stepTarget, { color: zoneColor }]}>{secToPace(target.minSecPerKm)}–{secToPace(target.maxSecPerKm)}/km {snapshot.zone === 'too-fast' ? '· mais rápido que a faixa' : snapshot.zone === 'too-slow' ? '· mais lento que a faixa' : snapshot.zone === 'in-zone' ? '· dentro da faixa' : ''}</Text> : null}
          </View>
        ) : snapshot.finishedProgram ? <Text style={styles.done}>Programa concluído. Pode encerrar o treino.</Text> : null}
        <View style={styles.grid}>
          <View style={styles.metric}><Text style={styles.metricLabel}>DISTÂNCIA</Text><Text style={styles.metricValue}>{km(snapshot.distanceM)} km</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>RITMO ATUAL</Text><Text style={styles.metricValue}>{paused ? 'PAUSADO' : secToPace(snapshot.currentPaceSecPerKm)}</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>RITMO MÉDIO</Text><Text style={styles.metricValue}>{secToPace(snapshot.avgPaceSecPerKm)}/km</Text></View>
          <View style={styles.metric}><Text style={styles.metricLabel}>EM MOVIMENTO</Text><Text style={styles.metricValue}>{formatDuration(snapshot.movingMs)}</Text></View>
        </View>
        <Pressable style={styles.primary} onPress={() => { void (paused ? resumeCurrent().then((result) => { if (result) setMode(result.mode); }) : pauseCurrent()); }} accessibilityRole="button">
          <Text style={styles.primaryText}>{paused ? 'Retomar' : 'Pausar'}</Text>
        </Pressable>
        <Pressable style={styles.danger} onPress={finish} accessibilityRole="button"><Text style={styles.dangerText}>Finalizar</Text></Pressable>
        {message ? <Text style={styles.hint}>{message}</Text> : null}
      </ScrollView>
    );
  }

  if (stage === 'summary' && summary) return <SummaryView summary={summary} upload={upload} onRetry={() => void sendNow(summary.state.runId)} onClose={closeSummary} />;

  // pronto para iniciar
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.h1}>{session ? 'Iniciar treino' : 'Treino livre'}</Text>
      {session ? <Text style={styles.text}>{session.title}</Text> : <Text style={styles.text}>Um treino sem etapas: o Panzeri Run grava o tempo, a distância, o ritmo e o percurso.</Text>}
      {interrupted ? (
        <View style={styles.card}>
          <Text style={styles.h2}>Treino interrompido</Text>
          <Text style={styles.text}>Um treino ficou aberto: {km(interrupted.distanceM)} km gravados. O tempo parado não conta como treino.</Text>
          <Pressable style={styles.primary} disabled={busy} onPress={() => void resumeAfterClose()}><Text style={styles.primaryText}>Retomar o treino</Text></Pressable>
          <Pressable style={styles.secondary} disabled={busy} onPress={() => void finishInterrupted()}><Text style={styles.secondaryText}>Encerrar e guardar</Text></Pressable>
          <Pressable style={styles.secondary} disabled={busy} onPress={discardInterrupted}><Text style={styles.dangerText}>Descartar</Text></Pressable>
        </View>
      ) : null}
      {session && program.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.h2}>Etapas do treino</Text>
          {program.map((step) => <Text key={step.executionId} style={styles.text}>{step.ordinal}. {stepLabel(step)}</Text>)}
        </View>
      ) : session ? <Text style={styles.hint}>Este treino será gravado sem o guia de etapas: o tempo, a distância e o percurso ficam vinculados a ele.</Text> : null}
      <View style={styles.row}>
        <Text style={styles.text}>Avisos por voz</Text>
        <Switch value={settings.voice} onValueChange={(voice) => changeSettings({ voice })} />
      </View>
      <View style={styles.row}>
        <Text style={styles.text}>Vibração</Text>
        <Switch value={settings.vibration} onValueChange={(vibration) => changeSettings({ vibration })} />
      </View>
      <Text style={styles.hint}>O GPS só é ligado quando você iniciar o treino e desliga quando você encerrar ou pausar. Você pode bloquear a tela ou usar outro aplicativo; não feche o Panzeri Run.</Text>
      {!interrupted ? (
        <Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={() => void start()} accessibilityRole="button">
          {busy ? <ActivityIndicator color="#FFFFFF" /> : null}
          <Text style={styles.primaryText}>Iniciar treino</Text>
        </Pressable>
      ) : null}
      {message ? <Text style={styles.warn}>{message}</Text> : null}
      <Pressable style={styles.secondary} onPress={onClose}><Text style={styles.secondaryText}>Voltar</Text></Pressable>
    </ScrollView>
  );
}

function SummaryView({ summary, upload, onRetry, onClose }: { summary: Summary; upload: UploadOutcome | 'sending' | null; onRetry: () => void; onClose: () => void }) {
  const { state, points } = summary;
  const snap = snapshotOf(state, state.endedAt ?? Date.now());
  const splits = kilometerSplits(points);
  const efforts = bestEfforts(points);
  const quality = gpsQuality(points);
  const uploadText = upload === 'sending' ? 'Enviando o treino…' : upload === 'sent' ? 'Treino enviado ao Panzeri Run.' : upload === 'consent_required' ? 'Treino guardado no celular. Autorize a gravação para ele ser enviado.' : upload === 'rejected' ? 'O servidor não aceitou este treino. Ele continua guardado no celular.' : upload === 'failed' ? 'Sem conexão agora. O treino está guardado e será enviado quando você abrir o Iniciar treino com internet.' : null;
  return (
    <ScrollView contentContainerStyle={styles.page}>
      <Text style={styles.h1}>Treino concluído</Text>
      <View style={styles.grid}>
        <View style={styles.metric}><Text style={styles.metricLabel}>DISTÂNCIA</Text><Text style={styles.metricValue}>{km(state.distanceM)} km</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>TEMPO</Text><Text style={styles.metricValue}>{formatDuration(snap.timerMs)}</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>RITMO MÉDIO</Text><Text style={styles.metricValue}>{formatPace(state.distanceM, snap.timerMs)}/km</Text></View>
        <View style={styles.metric}><Text style={styles.metricLabel}>EM MOVIMENTO</Text><Text style={styles.metricValue}>{formatDuration(state.movingMs)}</Text></View>
      </View>
      {state.interrupted ? <Text style={styles.hint}>Este treino foi retomado depois de uma interrupção. O tempo parado não foi contado.</Text> : null}
      {uploadText ? <Text style={styles.hint}>{uploadText}</Text> : null}
      {upload === 'failed' || upload === 'consent_required' ? <Pressable style={styles.secondary} onPress={onRetry}><Text style={styles.secondaryText}>Tentar enviar de novo</Text></Pressable> : null}

      {state.stepLog.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.h2}>Prescrito × realizado</Text>
          {state.stepLog.map((result) => {
            const pace = result.actualMeters >= 20 ? result.actualMs / 1000 / (result.actualMeters / 1000) : null;
            const has = result.targetMinSecPerKm !== null && result.targetMaxSecPerKm !== null;
            const where = pace === null || !has ? '' : pace < result.targetMinSecPerKm! ? ' · mais rápido que a faixa' : pace > result.targetMaxSecPerKm! ? ' · mais lento que a faixa' : ' · dentro da faixa';
            return (
              <Text key={result.ordinal} style={styles.text}>
                {result.ordinal}. {result.name}{result.completed ? '' : ' (incompleta)'}: {result.plannedMeters !== null ? `${km(result.plannedMeters)} km previstos` : result.plannedSeconds !== null ? `${formatMinuteSecond(result.plannedSeconds)} previstos` : 'livre'}
                {has ? ` · faixa ${secToPace(result.targetMinSecPerKm)}–${secToPace(result.targetMaxSecPerKm)}/km` : ''} → {km(result.actualMeters)} km a {secToPace(pace)}/km{where}
              </Text>
            );
          })}
        </View>
      ) : null}

      {splits.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.h2}>Parciais por quilômetro</Text>
          {splits.map((split) => (
            <Text key={split.index} style={styles.text}>{split.index}{split.distanceM < 990 ? '*' : ''}: {secToPace(split.paceSecPerKm)}/km{split.elevationDeltaM !== null ? ` · ${split.elevationDeltaM > 0 ? '+' : ''}${split.elevationDeltaM} m` : ''}{split.reliable ? '' : ' · GPS com lacuna'}</Text>
          ))}
          <Text style={styles.hint}>* parcial final incompleta. Lacunas de sinal são sinalizadas, nunca escondidas.</Text>
        </View>
      ) : null}
      {efforts.length > 0 ? (
        <View style={styles.card}>
          <Text style={styles.h2}>Melhores trechos deste treino</Text>
          {efforts.map((effort) => <Text key={effort.label} style={styles.text}>{effort.label}: {formatDuration(effort.elapsedMs)} · {secToPace(effort.paceSecPerKm)}/km{effort.reliable ? '' : ' · GPS com lacuna'}</Text>)}
        </View>
      ) : null}
      <Text style={styles.hint}>Qualidade do GPS: {quality.label}{quality.gaps > 0 ? ` (${quality.gaps} lacuna${quality.gaps > 1 ? 's' : ''} de sinal)` : ''}.</Text>
      <Pressable style={styles.primary} onPress={onClose}><Text style={styles.primaryText}>Fechar</Text></Pressable>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  page: { padding: 16, gap: 12 },
  h1: { fontSize: 22, fontWeight: '800', color: '#0F172A' },
  h2: { fontSize: 16, fontWeight: '700', color: '#0F172A' },
  text: { fontSize: 14, color: '#334155' },
  hint: { fontSize: 12, color: '#475569' },
  warn: { fontSize: 13, color: '#B42318', fontWeight: '600' },
  done: { fontSize: 15, fontWeight: '700', color: '#15803D' },
  card: { borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 14, gap: 6, backgroundColor: '#FFFFFF' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  phase: { fontSize: 12, fontWeight: '800', letterSpacing: 2, color: '#0B3D5C', textAlign: 'center' },
  clock: { fontSize: 64, fontWeight: '800', color: '#0F172A', textAlign: 'center' },
  stepCard: { borderWidth: 2, borderRadius: 14, padding: 14, gap: 4, backgroundColor: '#FFFFFF' },
  stepName: { fontSize: 12, fontWeight: '800', letterSpacing: 1, color: '#475569' },
  stepMain: { fontSize: 26, fontWeight: '800', color: '#0F172A' },
  stepTarget: { fontSize: 14, fontWeight: '700' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  metric: { width: '47%', borderWidth: 1, borderColor: '#CBD5E1', borderRadius: 12, padding: 12, backgroundColor: '#FFFFFF' },
  metricLabel: { fontSize: 11, fontWeight: '700', color: '#64748B', letterSpacing: 1 },
  metricValue: { fontSize: 20, fontWeight: '800', color: '#0F172A' },
  primary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0B3D5C', borderRadius: 12, paddingVertical: 14 },
  primaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 16 },
  secondary: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#0B3D5C', borderRadius: 12, paddingVertical: 12 },
  secondaryText: { color: '#0B3D5C', fontWeight: '700', fontSize: 15 },
  danger: { alignItems: 'center', justifyContent: 'center', paddingVertical: 12 },
  dangerText: { color: '#B42318', fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.5 },
});
