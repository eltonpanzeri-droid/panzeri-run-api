import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { fetchJsonAuth, fetchSnapshots } from './homeApi';
import { DomainVariable, SnapshotLite } from './insights';
import { VariableBlock } from './FeelingsDetailScreen';
import { HR_DECOUPLING_CATEGORIES, HrDecouplingCategoryId, comparisonSentences, hrDecouplingPct as pct, hrDecouplingVariableId } from './hrDecouplingInfo';

// "Desacoplamento da Frequência Cardíaca" na área "Resposta à carga" (03/11/2026). Modalidade fixa: Corrida (sem seletor). Tudo vem do servidor: o valor de cada corrida elegível, as
// referências (média histórica, médias móveis, faixa habitual) e a auditoria de quais corridas entraram e por que as outras não. Nenhuma conta aqui; o texto descreve, não julga.

interface AuditEntry {
  activityLogId: string; startedAt: string; eligible: boolean; category: HrDecouplingCategoryId | null; exclusionText: string | null; durationSec: number | null;
}

const dateText = (iso: string) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });

function variableOf(category: (typeof HR_DECOUPLING_CATEGORIES)[number]): DomainVariable {
  return {
    id: hrDecouplingVariableId(category.id),
    label: `Corridas de ${category.label}`,
    unit: '%',
    format: pct,
    scaleHint: 'Positivo: a frequência cardíaca subiu mais na segunda metade da corrida. Zero ou negativo: não subiu. O número, sozinho, não indica melhora nem piora.',
  };
}

export function HrDecouplingSection({ accessToken }: { accessToken: string }) {
  const ids = HR_DECOUPLING_CATEGORIES.map((c) => hrDecouplingVariableId(c.id));
  const [snapshots, setSnapshots] = useState<Record<string, SnapshotLite | null> | null>(null);
  const [audit, setAudit] = useState<AuditEntry[] | null | undefined>(undefined);
  const [selected, setSelected] = useState<HrDecouplingCategoryId | null>(null);

  useEffect(() => {
    let alive = true;
    fetchSnapshots(ids, accessToken, { reference: true }).then((m) => { if (alive) setSnapshots(m); });
    fetchJsonAuth<AuditEntry[]>('/me/hr-decoupling/audit', accessToken).then((a) => { if (alive) setAudit(a); });
    return () => { alive = false; };
  }, [accessToken]);

  const counts = useMemo(() => Object.fromEntries(HR_DECOUPLING_CATEGORIES.map((c) => [c.id, snapshots?.[hrDecouplingVariableId(c.id)]?.evidence.n ?? 0])) as Record<HrDecouplingCategoryId, number>, [snapshots]);
  // Faixa mostrada ao abrir: a da corrida elegível mais recente; sem nenhuma, a primeira.
  const defaultCategory = useMemo<HrDecouplingCategoryId>(() => {
    let best: { id: HrDecouplingCategoryId; at: string } | null = null;
    for (const c of HR_DECOUPLING_CATEGORIES) {
      const obs = snapshots?.[hrDecouplingVariableId(c.id)]?.observations ?? [];
      const at = obs.length > 0 ? obs[obs.length - 1].timestamp : null;
      if (at && (!best || at > best.at)) best = { id: c.id, at };
    }
    return best?.id ?? 'd30';
  }, [snapshots]);
  const category = selected ?? defaultCategory;

  if (snapshots === null) return <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.component }} />;

  const current = HR_DECOUPLING_CATEGORIES.find((c) => c.id === category)!;
  const snapshot = snapshots[hrDecouplingVariableId(category)];
  const total = audit?.length ?? 0;
  const eligible = audit?.filter((a) => a.eligible).length ?? 0;
  const excluded = (audit ?? []).filter((a) => !a.eligible).slice(0, 5);
  const sentences = comparisonSentences(snapshot);

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Desacoplamento da frequência cardíaca</Text>

      <View style={styles.chips}>
        {HR_DECOUPLING_CATEGORIES.map((c) => (
          <Pressable key={c.id} onPress={() => setSelected(c.id)} style={[styles.chip, category === c.id && styles.chipActive]} accessibilityRole="button">
            <Text style={[styles.chipText, category === c.id && styles.chipTextActive]}>{c.label} · {counts[c.id]}</Text>
          </Pressable>
        ))}
      </View>

      <VariableBlock variable={variableOf(current)} snapshot={snapshot} accessToken={accessToken} />

      <View style={[styles.block, HomeBorder.card]}>
        <Text style={styles.blockTitle}>Quais corridas entram</Text>
        {audit === undefined ? (
          <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} />
        ) : audit === null ? (
          <Text style={styles.hint}>Não foi possível carregar a lista de corridas agora.</Text>
        ) : total === 0 ? (
          <Text style={styles.hint}>Ainda não há corridas com registro segundo a segundo de velocidade e frequência cardíaca.</Text>
        ) : (
          <>
            <Text style={styles.sentence}>{eligible} de {total} {total === 1 ? 'corrida entrou' : 'corridas entraram'} neste indicador.</Text>
            {excluded.length > 0 ? <Text style={styles.hint}>Últimas corridas que não entraram:</Text> : null}
            {excluded.map((a) => <Text key={a.activityLogId} style={styles.sentence}>• {dateText(a.startedAt)}: {a.exclusionText ?? 'não elegível'}</Text>)}
          </>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.related },
  title: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  subtitle: { ...HomeTypography.body, color: HomeColors.textSecondary },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: HomeRadius.small, borderWidth: 1, borderColor: HomeColors.textTertiary },
  chipActive: { backgroundColor: HomeColors.panzeriPrimary, borderColor: HomeColors.panzeriPrimary },
  chipText: { ...HomeTypography.tertiary, color: HomeColors.textSecondary },
  chipTextActive: { color: HomeColors.surface },
  block: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 8 },
  blockTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  sentence: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  hint: { ...HomeTypography.tertiary, color: HomeColors.textTertiary },
});
