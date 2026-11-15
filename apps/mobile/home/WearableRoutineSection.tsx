import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeColors, HomeSpace, HomeTypography } from './homeTheme';
import { fetchSnapshots } from './homeApi';
import { SnapshotLite, WEARABLE_ROUTINE_VARIABLES } from './insights';
import { VariableBlock } from './FeelingsDetailScreen';

// Rotina do dia pelo RELÓGIO na área "Bem-estar e rotina" (15/11/2026): passos, calorias ativas e distância. Mesma leitura do servidor (wearable.*, fonte principal da aluna, nunca mistura marcas).
// Sem seletor de modalidade (é dado do dia, não do treino). Sem dado do relógio, a seção diz isso em vez de mostrar gráfico vazio.
export function WearableRoutineSection({ accessToken }: { accessToken: string }) {
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotLite | null> | null>(null);
  useEffect(() => {
    let alive = true;
    fetchSnapshots(WEARABLE_ROUTINE_VARIABLES.map((v) => v.id), accessToken, { reference: true }).then((m) => { if (alive) setSnapshots(m); });
    return () => { alive = false; };
  }, [accessToken]);

  if (!snapshots) return <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />;
  const withData = WEARABLE_ROUTINE_VARIABLES.filter((v) => (snapshots[v.id]?.evidence.n ?? 0) > 0);
  return (
    <View style={styles.container}>
      {withData.length === 0 ? (
        <Text style={styles.empty}>Seu relógio ainda não enviou passos, calorias ou distância do dia. Quando enviar, eles aparecem aqui.</Text>
      ) : withData.map((v) => <VariableBlock key={v.id} variable={v} snapshot={snapshots[v.id]} accessToken={accessToken} allowModality={false} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.related },
  empty: { ...HomeTypography.body, color: HomeColors.textSecondary },
});
