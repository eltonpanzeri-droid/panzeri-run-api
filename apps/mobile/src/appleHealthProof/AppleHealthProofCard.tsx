import React, { useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import {
  isAppleHealthSupported,
  isHealthDataAvailable,
  getHealthAuthorizationRequestStatus,
  requestHealthAuthorization,
  readRecentRunningWorkouts,
  requestWorkoutAuthorization,
  scheduleRunWorkout,
  listScheduledWorkouts,
  removeAllScheduledWorkouts,
} from '../../modules/panzeri-apple-health/src';

// Bloco 1 (prova tecnica, 05/10/2026) — Apple Watch via HealthKit + WorkoutKit. Tela de teste, SO iOS nativo, ligada por
// extra.appleHealthProof em app.json (remover a flag desliga). Nao envia nada para API/treinador/analytics/IA; nao grava
// em ActivityLog. O resultado de cada passo aparece so na propria tela.

function uuidV4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (char) => {
    const random = (Math.random() * 16) | 0;
    return (char === 'x' ? random : (random & 0x3) | 0x8).toString(16);
  });
}

function formatDuration(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}min ${Math.round(seconds % 60)}s`;
}

export function AppleHealthProofCard() {
  const enabled = Platform.OS === 'ios' && isAppleHealthSupported && Constants.expoConfig?.extra?.appleHealthProof === true;
  const [busy, setBusy] = useState(false);
  const [lines, setLines] = useState<string[]>([]);
  const [lastPlanId, setLastPlanId] = useState<string | null>(null);

  if (!enabled) return null;

  function log(...entries: string[]) {
    setLines((current) => [...current, ...entries]);
  }

  async function run(label: string, action: () => Promise<void>) {
    if (busy) return;
    setBusy(true);
    log(`> ${label}`);
    try {
      await action();
    } catch (error) {
      log(`ERRO: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setBusy(false);
    }
  }

  const steps: Array<{ label: string; action: () => Promise<void> }> = [
    {
      label: '1. Autorizar HealthKit (leitura de treinos)',
      action: async () => {
        log(`HealthKit disponivel no aparelho: ${isHealthDataAvailable() ? 'sim' : 'nao'}`);
        log(`Estado antes: ${await getHealthAuthorizationRequestStatus()}`);
        await requestHealthAuthorization();
        log(`Estado depois: ${await getHealthAuthorizationRequestStatus()}`);
      },
    },
    {
      label: '2. Ler ultimas corridas (HKWorkout)',
      action: async () => {
        const workouts = await readRecentRunningWorkouts(5);
        if (workouts.length === 0) {
          log('Nenhuma corrida encontrada. (O iOS nao diz se a leitura foi negada: confira em Ajustes > Saude > Acesso a Dados > Panzeri Run.)');
          return;
        }
        for (const workout of workouts) {
          const km = workout.distanceMeters != null ? `${(workout.distanceMeters / 1000).toFixed(2)} km` : 'distancia indisponivel';
          log(
            `${workout.startDate} -> ${workout.endDate}`,
            `  ${formatDuration(workout.durationSeconds)} | ${km}`,
            `  origem: ${workout.sourceName} (${workout.sourceBundleId})${workout.deviceName ? ` | ${workout.deviceName}` : ''}`,
            `  id: ${workout.uuid}${workout.workoutPlanId ? ` | plano Panzeri: ${workout.workoutPlanId}` : ''}`,
          );
        }
      },
    },
    {
      label: '3. Autorizar WorkoutKit (agendar no Relogio)',
      action: async () => {
        log(`WorkoutKit: ${await requestWorkoutAuthorization()}`);
      },
    },
    {
      label: '4. Agendar corrida de 5 km (daqui a 1 hora)',
      action: async () => {
        const planId = uuidV4();
        const start = new Date(Date.now() + 60 * 60 * 1000);
        const result = await scheduleRunWorkout(planId, 5, start);
        setLastPlanId(result.planId);
        log(
          `Agendado: ${result.distanceKm} km para ${result.scheduledFor}`,
          `id Panzeri (WorkoutPlan.id): ${result.planId}`,
          'Abra o app Treino no Apple Watch (aba de treinos agendados/Plano).',
        );
      },
    },
    {
      label: '5. Listar agendados por este app',
      action: async () => {
        const items = await listScheduledWorkouts();
        if (items.length === 0) log('Nenhum treino agendado por este app.');
        for (const item of items) log(`${item.date ?? 'sem data'} | concluido: ${item.complete ? 'sim' : 'nao'} | id: ${item.planId}`);
      },
    },
    {
      label: '6. Remover agendados por este app',
      action: async () => {
        await removeAllScheduledWorkouts();
        setLastPlanId(null);
        log('Agendados removidos.');
      },
    },
  ];

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Prova Apple Watch (Bloco 1)</Text>
      <Text style={styles.hint}>Teste tecnico. Os dados do Saude ficam so neste aparelho e nao sao enviados a lugar nenhum.</Text>
      {steps.map((step) => (
        <Pressable key={step.label} style={[styles.button, busy && styles.buttonDisabled]} disabled={busy} onPress={() => void run(step.label, step.action)}>
          <Text style={styles.buttonText}>{step.label}</Text>
        </Pressable>
      ))}
      {busy ? <ActivityIndicator style={styles.spinner} /> : null}
      {lastPlanId ? <Text style={styles.hint}>Ultimo id agendado: {lastPlanId}</Text> : null}
      {lines.length > 0 ? (
        <View style={styles.log}>
          {lines.map((line, index) => (
            <Text key={`${index}-${line}`} style={styles.logText}>{line}</Text>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 16, padding: 14, borderWidth: 1, borderColor: '#246F91', borderRadius: 8, gap: 8 },
  title: { fontSize: 16, fontWeight: '700', color: '#071827' },
  hint: { fontSize: 12, color: '#4a5560' },
  button: { paddingVertical: 10, paddingHorizontal: 12, borderRadius: 6, borderWidth: 1, borderColor: '#246F91' },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { fontSize: 14, color: '#246F91', fontWeight: '600' },
  spinner: { marginTop: 4 },
  log: { marginTop: 6, padding: 8, borderRadius: 6, backgroundColor: '#F4F0E6', gap: 2 },
  logText: { fontSize: 11, color: '#071827', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
