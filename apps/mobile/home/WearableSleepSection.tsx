import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeColors, HomeSpace, HomeTypography } from './homeTheme';
import { fetchSnapshots } from './homeApi';
import { SnapshotLite, WEARABLE_SLEEP_VARIABLES } from './insights';
import { VariableBlock } from './FeelingsDetailScreen';

// Sono medido pelo RELOGIO na area "Sono e recuperacao" da Evolucao (02/11/2026, lote 6): duracao, fases, pontuacao do fabricante e HRV da noite. Todas as variaveis vem do servidor
// (wearable.*, mesma camada longitudinal: faixa, media movel e escolha de fonte). Fontes diferentes nunca se misturam: com mais de uma fonte com dado, a aluna escolhe qual ver. Sem dado do
// relogio a secao diz isso em vez de mostrar grafico vazio.
export function WearableSleepSection({ accessToken }: { accessToken: string }) {
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotLite | null> | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSnapshots(WEARABLE_SLEEP_VARIABLES.map((v) => v.id), accessToken, { reference: true }).then((m) => { if (alive) setSnapshots(m); });
    return () => { alive = false; };
  }, [accessToken]);

  if (!snapshots) return <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />;
  const withData = WEARABLE_SLEEP_VARIABLES.filter((v) => (snapshots[v.id]?.evidence.n ?? 0) > 0);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Sono medido pelo relógio</Text>
      <Text style={styles.subtitle}>Mostramos aqui o que o seu relógio mede, separado do que você informa nos feedbacks dos treinos.</Text>
      {withData.length === 0 ? (
        <Text style={styles.empty}>Seu relógio ainda não enviou dados de sono ou de variabilidade da frequência cardíaca. Quando enviar, eles aparecem aqui.</Text>
      ) : withData.map((v) => <VariableBlock key={v.id} variable={v} snapshot={snapshots[v.id]} accessToken={accessToken} />)}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.related },
  title: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  subtitle: { ...HomeTypography.body, color: HomeColors.textSecondary },
  empty: { ...HomeTypography.body, color: HomeColors.textSecondary },
});
