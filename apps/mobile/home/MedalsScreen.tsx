import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography, MedalGrauColors, formatMetric } from './homeTheme';
import { categoryLabel, formatShortDate, UnlockedMedalLite } from './homeLogic';

// Tela "Todas as conquistas" (30/09/2026, ordem fechada, seção 14) — única tela secundária nova
// autorizada nesta intervenção. Consumidora pura de GET /me/medals (unlocked + progress) — nenhuma
// lógica de elegibilidade/filtro reimplementada aqui (o backend já decide o que é "próxima
// conquista recomendada"; esta tela só agrupa e exibe).
//
// 15/10/2026 — correção de atividades x conquistas: a tela distingue (1) conquistadas agora, (2) reativadas,
// (3) revogadas (com o motivo) e (4) em atualização (reavaliação pendente depois de uma correção), e mostra o
// histórico das transições sob demanda. Tudo vem pronto de GET /me/medals e GET /me/medals/history; nada é decidido aqui.

const API_URL = Platform.OS === 'web' ? '/api' : 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
const POLL_MS = 5000;
const MAX_POLLS = 6;

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

interface RevokedMedalLite {
  code: string;
  category: string;
  name: string;
  description: string;
  grau: string;
  unit: string | null;
  unlockedAt: string;
  revokedAt: string | null;
  revokedReason: string | null;
  reasonText: string;
  provisional: boolean;
}

interface PendingLite {
  updating: boolean;
  since: string | null;
  medalCategories: string[];
  analysisSessions: number;
}

interface HistoryEntryLite {
  id: string;
  code: string;
  name: string;
  grau: string;
  type: string;
  typeLabel: string;
  at: string;
  reason: string | null;
  reasonText: string;
}

interface MedalsSummaryLite {
  unlocked: UnlockedMedalLite[];
  progress: NextUpMedalLite[];
  revoked?: RevokedMedalLite[];
  pending?: PendingLite;
}

type FilterMode = 'all' | 'unlocked' | 'progress' | 'revoked';

function MedalBadge({ grau, size = 44, muted = false }: { grau: string; size?: number; muted?: boolean }) {
  const color = muted ? HomeColors.surfaceSecondary : MedalGrauColors[grau] ?? MedalGrauColors.bronze;
  return (
    <View style={{ width: size, height: size, borderRadius: size / 2, backgroundColor: color, alignItems: 'center', justifyContent: 'center' }}>
      <Ionicons name={muted ? 'ribbon-outline' : 'ribbon'} size={size * 0.5} color={muted ? HomeColors.textTertiary : '#FFFFFF'} />
    </View>
  );
}

function StatusTag({ label, tone }: { label: string; tone: 'updating' | 'reactivated' | 'revoked' }) {
  return (
    <View style={[styles.tag, tone === 'updating' ? styles.tagUpdating : tone === 'reactivated' ? styles.tagReactivated : styles.tagRevoked]}>
      <Text style={[styles.tagText, tone === 'updating' ? styles.tagTextUpdating : tone === 'reactivated' ? styles.tagTextReactivated : styles.tagTextRevoked]}>{label}</Text>
    </View>
  );
}

export function MedalsScreen({ accessToken, onBack }: { accessToken: string; onBack: () => void }) {
  const [data, setData] = useState<MedalsSummaryLite | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [showHistory, setShowHistory] = useState(false);
  const [history, setHistory] = useState<HistoryEntryLite[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [polls, setPolls] = useState(0);

  const load = useCallback(async (alive: () => boolean) => {
    try {
      const res = await fetch(`${API_URL}/me/medals`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) throw new Error('failed');
      const json = (await res.json()) as MedalsSummaryLite;
      if (alive()) { setData(json); setError(false); }
    } catch {
      if (alive()) setError(true);
    } finally {
      if (alive()) setLoading(false);
    }
  }, [accessToken]);

  useEffect(() => {
    let alive = true;
    void load(() => alive);
    return () => { alive = false; };
  }, [load]);

  // Enquanto uma reavaliacao esta pendente (correcao recente), pergunta de novo algumas vezes: o dado so' deixa de ser "em atualizacao" quando o servidor conclui.
  useEffect(() => {
    if (!data?.pending?.updating || polls >= MAX_POLLS) return undefined;
    let alive = true;
    const timer = setTimeout(() => { setPolls((n) => n + 1); void load(() => alive); }, POLL_MS);
    return () => { alive = false; clearTimeout(timer); };
  }, [data, polls, load]);

  const toggleHistory = useCallback(async () => {
    const next = !showHistory;
    setShowHistory(next);
    if (!next || history) return;
    setHistoryLoading(true);
    try {
      const res = await fetch(`${API_URL}/me/medals/history`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (res.ok) setHistory((await res.json()) as HistoryEntryLite[]);
      else setHistory([]);
    } catch {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, [showHistory, history, accessToken]);

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

  const revoked = data.revoked ?? [];
  const updating = data.pending?.updating === true;
  const totalUnlocked = data.unlocked.length;
  const totalProgress = data.progress.filter((p) => !unlockedCodes.has(p.code)).length;
  const hasHistory = revoked.length > 0 || data.unlocked.some((m) => m.reactivatedAt);
  const filters: FilterMode[] = revoked.length > 0 ? ['all', 'unlocked', 'progress', 'revoked'] : ['all', 'unlocked', 'progress'];
  const filterLabel = (f: FilterMode) => (f === 'all' ? 'Todas' : f === 'unlocked' ? 'Conquistadas' : f === 'progress' ? 'Em progresso' : 'Revogadas');

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
        {revoked.length > 0 ? (
          <>
            <Text style={styles.summaryDot}>•</Text>
            <Text style={styles.summaryItem}>{revoked.length} revogadas</Text>
          </>
        ) : null}
      </View>

      {updating ? (
        <View style={styles.updatingCard}>
          <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} />
          <Text style={styles.updatingText}>
            Estamos atualizando suas conquistas depois de uma correção nos seus registros. As marcadas como "Em atualização" ainda podem mudar.
          </Text>
        </View>
      ) : null}

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
          <Text style={styles.explainStrong}>Se você corrigir uma atividade: </Text>
          as conquistas são reavaliadas. Se o critério deixar de ser atendido, a conquista fica como "revogada", com o motivo; se voltar a ser atendido, ela é reativada. O histórico fica guardado.
        </Text>
        <Text style={styles.explainText}>
          <Text style={styles.explainStrong}>O que representam: </Text>
          um registro da sua própria história no Panzeri Run. Não são nota nem comparação com outras pessoas.
        </Text>
      </View>

      <View style={styles.filterRow}>
        {filters.map((f) => (
          <Pressable key={f} onPress={() => setFilter(f)} style={[styles.filterPill, filter === f && styles.filterPillActive]}>
            <Text style={[styles.filterPillText, filter === f && styles.filterPillTextActive]}>{filterLabel(f)}</Text>
          </Pressable>
        ))}
      </View>

      {filter !== 'revoked' && [...byCategory.entries()].map(([category, entry]) => {
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
                    {item.medal.reactivatedAt ? <Text style={styles.medalMeta}>Reativada em {formatShortDate(item.medal.reactivatedAt)}</Text> : null}
                    {item.medal.provisional || item.medal.reactivatedAt ? (
                      <View style={styles.tagRow}>
                        {item.medal.provisional ? <StatusTag label="Em atualização" tone="updating" /> : null}
                        {item.medal.reactivatedAt ? <StatusTag label="Reativada" tone="reactivated" /> : null}
                      </View>
                    ) : null}
                  </View>
                  <Ionicons name={item.medal.provisional ? 'sync-circle' : 'checkmark-circle'} size={20} color={item.medal.provisional ? HomeColors.textTertiary : HomeColors.success} />
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

      {revoked.length > 0 && (filter === 'all' || filter === 'revoked') ? (
        <View style={styles.categoryBlock}>
          <Text style={styles.categoryTitle}>Revogadas</Text>
          {revoked.map((medal) => (
            <View key={medal.code} style={[styles.medalRow, styles.medalRowLocked, HomeBorder.card]}>
              <MedalBadge grau={medal.grau} muted />
              <View style={{ flex: 1 }}>
                <Text style={styles.medalName}>{medal.name}</Text>
                <Text style={styles.medalMeta}>Conquistada em {formatShortDate(medal.unlockedAt)}{medal.revokedAt ? ` · Revogada em ${formatShortDate(medal.revokedAt)}` : ''}</Text>
                <Text style={styles.medalReason}>{medal.reasonText}</Text>
                <View style={styles.tagRow}>
                  <StatusTag label="Revogada" tone="revoked" />
                  {medal.provisional ? <StatusTag label="Em atualização" tone="updating" /> : null}
                </View>
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {hasHistory || updating ? (
        <View style={styles.categoryBlock}>
          <Pressable onPress={() => void toggleHistory()} style={styles.historyToggle}>
            <Text style={styles.historyToggleText}>{showHistory ? 'Ocultar histórico das conquistas' : 'Ver histórico das conquistas'}</Text>
            <Ionicons name={showHistory ? 'chevron-up' : 'chevron-down'} size={16} color={HomeColors.panzeriInteraction} />
          </Pressable>
          {showHistory ? (
            historyLoading ? <ActivityIndicator color={HomeColors.panzeriInteraction} /> : (history ?? []).length === 0 ? (
              <Text style={styles.emptyText}>Nenhuma mudança registrada ainda.</Text>
            ) : (
              (history ?? []).map((entry) => (
                <View key={entry.id} style={[styles.historyRow, HomeBorder.card]}>
                  <Text style={styles.historyTitle}>{entry.typeLabel} · {entry.name}</Text>
                  <Text style={styles.medalMeta}>{formatShortDate(entry.at)}</Text>
                  <Text style={styles.medalReason}>{entry.reasonText}</Text>
                </View>
              ))
            )
          ) : null}
        </View>
      ) : null}
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
  summaryRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4, marginBottom: HomeSpace.related, flexWrap: 'wrap' },
  summaryItem: { ...HomeTypography.bodyMedium, color: HomeColors.textSecondary },
  summaryDot: { color: HomeColors.textTertiary },
  updatingCard: { flexDirection: 'row', alignItems: 'center', gap: HomeSpace.related, backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardMedium, padding: HomeSpace.related },
  updatingText: { ...HomeTypography.body, color: HomeColors.textPrimary, flex: 1, lineHeight: 20 },
  explainCard: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardMedium, padding: HomeSpace.component, gap: 6, marginBottom: HomeSpace.component },
  explainTitle: { ...HomeTypography.sectionTitle, color: HomeColors.textPrimary },
  explainText: { ...HomeTypography.body, color: HomeColors.textPrimary, lineHeight: 21 },
  explainStrong: { fontWeight: '700' },
  filterRow: { flexDirection: 'row', gap: HomeSpace.small, marginBottom: HomeSpace.component, flexWrap: 'wrap' },
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
  medalReason: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginTop: 4, lineHeight: 18 },
  tagRow: { flexDirection: 'row', gap: 6, marginTop: 6, flexWrap: 'wrap' },
  tag: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: HomeRadius.pill },
  tagText: { ...HomeTypography.tertiary, fontWeight: '700' },
  tagUpdating: { backgroundColor: '#FEF3C7' },
  tagTextUpdating: { color: '#92400E' },
  tagReactivated: { backgroundColor: '#DCFCE7' },
  tagTextReactivated: { color: '#166534' },
  tagRevoked: { backgroundColor: HomeColors.surfaceSecondary },
  tagTextRevoked: { color: HomeColors.textSecondary },
  historyToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: HomeSpace.small },
  historyToggleText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },
  historyRow: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardMedium, padding: HomeSpace.related },
  historyTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
});
