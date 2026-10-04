import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography, MedalGrauColors, formatMetric } from './homeTheme';
import { categoryLabel, formatShortDate, UnlockedMedalLite } from './homeLogic';

// Tela "Todas as conquistas" (30/09/2026, ordem fechada, seção 14) — única tela secundária nova
// autorizada nesta intervenção. Consumidora pura de GET /me/medals (unlocked + progress) — nenhuma
// lógica de elegibilidade/filtro reimplementada aqui (o backend já decide o que é "próxima
// conquista recomendada"; esta tela só agrupa e exibe).

const API_URL = Platform.OS === 'web' ? '/api' : 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';

interface NextUpMedalLite {
  code: string;
  category: string;
  name: string;
  description: string;
  grau: string;
  threshold: number | null;
  unit: string | null;
  currentValue: number | null;
  recommendedAsNextGoal: boolean | null;
}

interface MedalsSummaryLite {
  unlocked: UnlockedMedalLite[];
  progress: NextUpMedalLite[];
}

type FilterMode = 'all' | 'unlocked' | 'progress';

function MedalBadge({ grau, size = 44 }: { grau: string; size?: number }) {
  const color = MedalGrauColors[grau] ?? MedalGrauColors.bronze;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name="ribbon" size={size * 0.5} color="#FFFFFF" />
    </View>
  );
}

export function MedalsScreen({ accessToken, onBack }: { accessToken: string; onBack: () => void }) {
  const [data, setData] = useState<MedalsSummaryLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`${API_URL}/me/medals`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!res.ok) throw new Error('failed');
        const json = (await res.json()) as MedalsSummaryLite;
        if (alive) setData(json);
      } catch {
        if (alive) setError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [accessToken]);

  const unlockedCodes = useMemo(() => new Set((data?.unlocked ?? []).map((m) => m.code)), [data]);
  const byCategory = useMemo(() => {
    const map = new Map<string, { unlocked: UnlockedMedalLite[]; progress: NextUpMedalLite[] }>();
    for (const m of data?.unlocked ?? []) {
      const entry = map.get(m.category) ?? { unlocked: [], progress: [] };
      entry.unlocked.push(m);
      map.set(m.category, entry);
    }
    for (const m of data?.progress ?? []) {
      if (unlockedCodes.has(m.code)) continue;
      const entry = map.get(m.category) ?? { unlocked: [], progress: [] };
      entry.progress.push(m);
      map.set(m.category, entry);
    }
    return map;
  }, [data, unlockedCodes]);

  if (loading) {
    return (
      <View style={styles.loadingWrap}>
        <ActivityIndicator color={HomeColors.panzeriInteraction} />
      </View>
    );
  }
  if (error || !data) {
    return (
      <View style={styles.loadingWrap}>
        <Text style={styles.emptyText}>Não foi possível carregar suas conquistas agora.</Text>
      </View>
    );
  }

  const totalUnlocked = data.unlocked.length;
  const totalProgress = data.progress.filter((p) => !unlockedCodes.has(p.code)).length;

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable onPress={onBack} style={styles.backRow}>
        <Ionicons name="chevron-back" size={18} color={HomeColors.panzeriInteraction} />
        <Text style={styles.backText}>Voltar</Text>
      </Pressable>
      <Text style={styles.header}>Suas conquistas</Text>
      <View style={styles.summaryRow}>
        <Text style={styles.summaryItem}>{totalUnlocked} conquistadas</Text>
        <Text style={styles.summaryDot}>•</Text>
        <Text style={styles.summaryItem}>{totalProgress} próximas</Text>
      </View>

      {/* Explicacao simples (04/10/2026): o que sao, como funcionam e o que representam. */}
      <View style={styles.explainCard}>
        <Text style={styles.explainTitle}>Como as conquistas funcionam</Text>
        <Text style={styles.explainText}>
          <Text style={styles.explainStrong}>O que são: </Text>
          marcos reais da sua trajetória, reconhecidos automaticamente a partir do que você registra — treinos, distância, constância, feedbacks, retomadas e provas.
        </Text>
        <Text style={styles.explainText}>
          <Text style={styles.explainStrong}>Como funcionam: </Text>
          cada conquista tem um grau (bronze, prata, ouro, platina, diamante e lendária) que indica a dificuldade. Ao alcançar, ela fica registrada com a data e o valor que a gerou. As "em progresso" mostram quanto falta.
        </Text>
        <Text style={styles.explainText}>
          <Text style={styles.explainStrong}>O que representam: </Text>
          um registro da sua própria história no Panzeri Run. Não são nota nem comparação com outras pessoas.
        </Text>
      </View>

      <View style={styles.filterRow}>
        {(['all', 'unlocked', 'progress'] as FilterMode[]).map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterPill, filter === f && styles.filterPillActive]}>
            <Text style={[styles.filterPillText, filter === f && styles.filterPillTextActive]}>
              {f === 'all' ? 'Todas' : f === 'unlocked' ? 'Conquistadas' : 'Em progresso'}
            </Text>
          </Pressable>
        ))}
      </View>

      {[...byCategory.entries()].map(([category, entry]) => {
        const showUnlocked = filter !== 'progress';
        const showProgress = filter !== 'unlocked';
        const items = [
          ...(showUnlocked ? entry.unlocked.map((m) => ({ kind: 'unlocked' as const, medal: m })) : []),
          ...(showProgress ? entry.progress.map((m) => ({ kind: 'progress' as const, medal: m })) : []),
        ];
        if (items.length === 0) return null;

        return (
          <View key={category} style={styles.categoryBlock}>
            <Text style={styles.categoryTitle}>{categoryLabel(category)}</Text>
            {items.map((item) =>
              item.kind === 'unlocked' ? (
                <View key={item.medal.code} style={[styles.medalRow, HomeBorder.card]}>
                  <MedalBadge grau={item.medal.grau} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medalName}>{item.medal.name}</Text>
                    <Text style={styles.medalMeta}>Conquistada em {formatShortDate(item.medal.unlockedAt)}</Text>
                  </View>
                  <Ionicons name="checkmark-circle" size={20} color={HomeColors.success} />
                </View>
              ) : (
                <View key={item.medal.code} style={[styles.medalRow, styles.medalRowLocked, HomeBorder.card]}>
                  <View style={[styles.medalBadgeLocked]}>
                    <Ionicons name="lock-closed" size={18} color={HomeColors.textTertiary} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.medalName}>{item.medal.name}</Text>
                    {item.medal.threshold != null && (
                      <Text style={styles.medalMeta}>
                        {formatMetric(item.medal.currentValue)}/{formatMetric(item.medal.threshold)} {item.medal.unit ?? ''}
                      </Text>
                    )}
                  </View>
                </View>
              ),
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { padding: HomeSpace.component, gap: HomeSpace.related, backgroundColor: HomeColors.background },
  loadingWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },
  emptyText: { ...HomeTypography.body, color: HomeColors.textSecondary },
  backRow: { flexDirection: 'row', alignItems: 'center', marginBottom: HomeSpace.small },
  backText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },
  header: { ...HomeTypography.greeting, color: HomeColors.textPrimary },
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: HomeSpace.related },
  summaryItem: { ...HomeTypography.bodyMedium, color: HomeColors.textSecondary },
  summaryDot: { color: HomeColors.textTertiary },
  explainCard: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardMedium, padding: HomeSpace.component, gap: 6, marginBottom: HomeSpace.component },
  explainTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  explainText: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  explainStrong: { fontWeight: '700' },
  filterRow: { flexDirection: 'row', gap: HomeSpace.small, marginBottom: HomeSpace.component },
  filterPill: { paddingVertical: 8, paddingHorizontal: 14, borderRadius: HomeRadius.pill, backgroundColor: HomeColors.surfaceSecondary },
  filterPillActive: { backgroundColor: HomeColors.panzeriPrimary },
  filterPillText: { ...HomeTypography.label, color: HomeColors.textSecondary },
  filterPillTextActive: { color: '#FFFFFF' },
  categoryBlock: { marginBottom: HomeSpace.component, gap: HomeSpace.small },
  categoryTitle: { ...HomeTypography.sectionTitle, fontSize: 17, color: HomeColors.textPrimary, marginBottom: 4 },
  medalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: HomeSpace.related,
    backgroundColor: HomeColors.surface,
    borderRadius: HomeRadius.cardMedium,
    padding: HomeSpace.related,
  },
  medalRowLocked: { opacity: 0.85 },
  medalBadgeLocked: { width: 44, height: 44, borderRadius: 22, backgroundColor: HomeColors.surfaceSecondary, alignItems: 'center', justifyContent: 'center' },
  medalName: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  medalMeta: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginTop: 2 },
});
