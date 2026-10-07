import React, { useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Constants from 'expo-constants';
import { isAppleHealthSupported, validateCustomWorkoutSpec } from '../../modules/panzeri-apple-health/src';
import { CustomWorkoutBridgeResult, validateAppleSpecOnDevice } from './customWorkoutBridge';
import { CUSTOM_WORKOUT_PROBE_CASES } from './customWorkoutProbeSpecs';

// SONDA TEMPORARIA (Apple Etapa 6) — executa no iPhone real a MESMA ponte validateCustomWorkoutSpec (customWorkoutBridge) com os tres specs de
// referencia. NAO agenda nada, NAO pede autorizacao do WorkoutScheduler, NAO usa o botao real nem o WorkoutDelivery. So' aparece no app nativo
// iOS com extra.appleHealthProof (a mesma flag da "Prova Apple Watch"). Objetivo principal: descobrir se um IntervalBlock com UM unico passo
// work passa pelo dataRepresentation.

type ProbeOutcome = { key: string; result: CustomWorkoutBridgeResult };

export function CustomWorkoutProbeCard() {
  const enabled = Platform.OS === 'ios' && isAppleHealthSupported && Constants.expoConfig?.extra?.appleHealthProof === true;
  const [outcomes, setOutcomes] = useState<ProbeOutcome[] | null>(null);
  if (!enabled) return null;

  function run() {
    const native = { isSupported: isAppleHealthSupported, validateCustomWorkoutSpec };
    setOutcomes(CUSTOM_WORKOUT_PROBE_CASES.map((probe) => ({ key: probe.key, result: validateAppleSpecOnDevice(native, probe.spec) })));
  }

  return (
    <View style={styles.card}>
      <Text style={styles.title}>Sonda nativa: CustomWorkout (temporária)</Text>
      <Text style={styles.hint}>Constrói e valida no iPhone os 3 specs de referência pela ponte validateCustomWorkoutSpec. Não agenda nada e não pede autorização do agendador.</Text>
      <Pressable style={styles.button} onPress={run}>
        <Text style={styles.buttonText}>Executar as 3 sondas</Text>
      </Pressable>
      {outcomes
        ? CUSTOM_WORKOUT_PROBE_CASES.map((probe) => {
            const outcome = outcomes.find((o) => o.key === probe.key)!.result;
            return (
              <View key={probe.key} style={styles.caseBox}>
                <Text style={styles.caseTitle}>{probe.title}</Text>
                <Text style={styles.hint}>{probe.note}</Text>
                <Text style={[styles.verdict, outcome.ok ? styles.valid : styles.invalid]}>{outcome.ok ? 'VÁLIDO' : 'INVÁLIDO'}</Text>
                {outcome.ok ? (
                  <Text style={styles.mono}>
                    {`blocos: ${outcome.summary.blocks.map((b) => `${b.iterations}×[${b.steps.map((s) => `${s.purpose} ${s.meters} m`).join(', ')}]`).join(' → ')}\ntotal: ${outcome.summary.totalMeters} m · plano serializado: ${outcome.summary.serializedBytes} bytes (dataRepresentation passou)`}
                  </Text>
                ) : (
                  <View>
                    <Text style={styles.reason}>{outcome.reason}</Text>
                    {outcome.errors.map((error, index) => (
                      <Text key={`${error.code}-${index}`} style={styles.mono}>{`code: ${error.code}\nmessage: ${error.message}\npath: ${error.path || '(raiz)'}`}</Text>
                    ))}
                  </View>
                )}
              </View>
            );
          })
        : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { marginTop: 12, padding: 12, borderRadius: 12, borderWidth: 1, borderColor: '#cbd5e1', backgroundColor: '#f8fafc', gap: 8 },
  title: { fontSize: 15, fontWeight: '700', color: '#0f172a' },
  hint: { fontSize: 12, color: '#475569' },
  button: { alignSelf: 'flex-start', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 8, borderWidth: 1, borderColor: '#0B3D5C', backgroundColor: '#fff' },
  buttonText: { color: '#0B3D5C', fontWeight: '700' },
  caseBox: { padding: 10, borderRadius: 8, backgroundColor: '#fff', borderWidth: 1, borderColor: '#e2e8f0', gap: 4 },
  caseTitle: { fontSize: 13, fontWeight: '700', color: '#0f172a' },
  verdict: { fontSize: 15, fontWeight: '800' },
  valid: { color: '#15803d' },
  invalid: { color: '#b91c1c' },
  reason: { fontSize: 13, fontWeight: '700', color: '#b91c1c' },
  mono: { fontSize: 11, color: '#0f172a', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
});
