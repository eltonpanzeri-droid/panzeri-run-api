import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';

// Atividades para confirmar (10/2026). EXCECAO, nunca etapa obrigatoria: o servidor ja' resolve sozinho (mesma atividade / atividades diferentes) sempre
// que ha evidencia; so' aparece aqui o que ficou realmente ambiguo (par de registros muito parecidos). Nada de pop-up, nada bloqueia treinos, nenhuma
// notificacao: um aviso discreto na Home e uma secao no Historico. A decisao e' aplicada NO SERVIDOR (identidade, canonica, reconciliacao) — este
// arquivo so' mostra e envia a resposta. URL duplicada de proposito (mesmo motivo da HomeScreen: evitar import circular com App.tsx).
const API_URL = Platform.OS === 'web' ? '/api' : 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';

export interface PendingObservation {
  activityLogId: string;
  sourceLabel: string;
  channelLabel: string | null;
  startedAt: string;
  startedAtLocal: string | null;
  modality: string;
  modalityLabel: string;
  distanceMeters: number | null;
  durationSec: number | null;
}

export interface PendingIdentity {
  key: string;
  // 'pending' = aguardando a resposta; 'processing' = resposta ja' registrada, ainda atualizando as atividades (sem botoes; o servidor conclui sozinho).
  status: 'pending' | 'processing';
  observations: PendingObservation[];
}

export function formatPendingDateTime(observation: Pick<PendingObservation, 'startedAt' | 'startedAtLocal'>): string {
  const local = observation.startedAtLocal;
  if (local && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(local)) return `${local.slice(8, 10)}/${local.slice(5, 7)} às ${local.slice(11, 16)}`;
  const date = new Date(observation.startedAt);
  if (Number.isNaN(date.getTime())) return 'Horário não informado';
  const day = String(date.getDate()).padStart(2, '0');
  const month = String(date.getMonth() + 1).padStart(2, '0');
  return `${day}/${month} às ${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

// Duas casas: aqui o aluno compara registros MUITO parecidos (ex.: 10,00 km x 10,35 km); arredondar para uma casa esconderia a diferenca.
export function formatPendingKm(distanceMeters: number | null): string | null {
  if (distanceMeters == null || !Number.isFinite(distanceMeters) || distanceMeters <= 0) return null;
  return `${(distanceMeters / 1000).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} km`;
}

export function formatPendingDuration(durationSec: number | null): string | null {
  if (durationSec == null || !Number.isFinite(durationSec) || durationSec <= 0) return null;
  const minutes = Math.round(durationSec / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')} min`;
}

export function usePendingIdentity(accessToken: string) {
  const [pending, setPending] = useState<PendingIdentity[]>([]);
  const [loading, setLoading] = useState(true);
  const refresh = useCallback(async () => {
    if (!accessToken) return;
    try {
      const response = await fetch(`${API_URL}/me/activity-reconciliation/pending-identity`, { headers: { Authorization: `Bearer ${accessToken}` } });
      setPending(response.ok ? ((await response.json()) as PendingIdentity[]) : []);
    } catch {
      setPending([]); // falha de rede nunca vira aviso nem bloqueio
    } finally {
      setLoading(false);
    }
  }, [accessToken]);
  useEffect(() => { void refresh(); }, [refresh]);
  return { pending, loading, refresh };
}

// Aviso discreto na tela inicial: uma linha, sem bloquear nada; leva a secao "Atividades para confirmar" do Historico.
export function PendingIdentityNotice({ accessToken, onOpen }: { accessToken: string; onOpen: () => void }) {
  const { pending: all } = usePendingIdentity(accessToken);
  const pending = all.filter((item) => item.status === 'pending'); // 'em atualizacao' nao pede nada ao aluno
  if (pending.length === 0) return null;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel="Atividade aguardando confirmação" onPress={onOpen} style={styles.notice}>
      <View style={styles.noticeDot} />
      <Text style={styles.noticeText}>
        {pending.length === 1 ? '1 atividade aguardando confirmação' : `${pending.length} atividades aguardando confirmação`}
      </Text>
      <Text style={styles.noticeAction}>Ver</Text>
    </Pressable>
  );
}

function ObservationCard({ observation }: { observation: PendingObservation }) {
  const km = formatPendingKm(observation.distanceMeters);
  const duration = formatPendingDuration(observation.durationSec);
  return (
    <View style={styles.observationCard}>
      <Text style={styles.observationSource}>{observation.sourceLabel}</Text>
      {observation.channelLabel ? <Text style={styles.observationChannel}>{observation.channelLabel}</Text> : null}
      <Text style={styles.observationLine}>{formatPendingDateTime(observation)}</Text>
      <Text style={styles.observationLine}>{observation.modalityLabel}</Text>
      {km ? <Text style={styles.observationLine}>{km}</Text> : null}
      {duration ? <Text style={styles.observationLine}>{duration}</Text> : null}
    </View>
  );
}

// Secao do Historico: cada pendencia e' uma linha compacta; ao tocar, abre a pergunta com os dois registros lado a lado.
export function PendingIdentitySection({ accessToken, onResolved }: { accessToken: string; onResolved?: () => void }) {
  const { pending, refresh } = usePendingIdentity(accessToken);
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  async function answer(item: PendingIdentity, decision: 'same' | 'distinct') {
    if (busyKey) return;
    setBusyKey(item.key);
    setMessage(null);
    try {
      const response = await fetch(`${API_URL}/me/activity-reconciliation/pending-identity/resolve`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ activityLogIds: item.observations.map((o) => o.activityLogId), decision }),
      });
      if (response.ok) {
        const data = (await response.json().catch(() => ({}))) as { applied?: boolean };
        // Nunca afirma que as estatisticas ja' foram atualizadas se o servidor ainda nao concluiu (applied=false): ele conclui sozinho e a secao mostra "atualizando".
        setMessage(data.applied === false ? 'Registramos a sua resposta. Ainda estamos atualizando suas atividades — isso termina sozinho.' : 'Obrigado! Atualizamos suas atividades.');
        setOpenKey(null);
        onResolved?.();
      } else if (response.status === 409) {
        setMessage('Essa confirmação já foi resolvida.'); // resposta repetida/concorrente ou resolvida pelo treinador
        setOpenKey(null);
      } else {
        setMessage('Não conseguimos registrar agora. Tente de novo em instantes.');
      }
    } catch {
      setMessage('Sem conexão para registrar agora. Tente de novo em instantes.');
    } finally {
      setBusyKey(null);
      await refresh();
    }
  }

  if (pending.length === 0 && !message) return null;
  return (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Atividades para confirmar</Text>
      {message ? <Text style={styles.sectionMessage}>{message}</Text> : null}
      {pending.map((item) => {
        const first = item.observations[0];
        const open = openKey === item.key;
        if (item.status === 'processing') {
          return (
            <View key={item.key} style={styles.pendingCard}>
              <View style={styles.pendingRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.pendingRowTitle}>{first.modalityLabel} · {formatPendingDateTime(first)}</Text>
                  <Text style={styles.pendingRowSub}>Resposta registrada · atualizando suas atividades</Text>
                </View>
                <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} />
              </View>
            </View>
          );
        }
        return (
          <View key={item.key} style={styles.pendingCard}>
            <Pressable accessibilityRole="button" onPress={() => setOpenKey(open ? null : item.key)} style={styles.pendingRow}>
              <View style={{ flex: 1 }}>
                <Text style={styles.pendingRowTitle}>{first.modalityLabel} · {formatPendingDateTime(first)}</Text>
                <Text style={styles.pendingRowSub}>{item.observations.map((o) => o.sourceLabel).join(' e ')}</Text>
              </View>
              <Text style={styles.noticeAction}>{open ? 'Fechar' : 'Responder'}</Text>
            </Pressable>
            {open ? (
              <View style={styles.pendingBody}>
                <Text style={styles.pendingTitle}>Precisamos confirmar uma atividade</Text>
                <Text style={styles.pendingText}>Recebemos dois registros muito semelhantes. Eles representam a mesma atividade física ou são atividades diferentes?</Text>
                <Text style={styles.pendingHint}>Isso pode acontecer quando recebemos registros de uma mesma atividade por diferentes dispositivos ou aplicativos.</Text>
                <View style={styles.observationRow}>
                  {item.observations.map((o) => <ObservationCard key={o.activityLogId} observation={o} />)}
                </View>
                {busyKey === item.key ? (
                  <ActivityIndicator size="small" color={HomeColors.panzeriInteraction} style={{ marginTop: HomeSpace.related }} />
                ) : (
                  <View style={styles.actions}>
                    <Pressable accessibilityRole="button" onPress={() => answer(item, 'same')} style={styles.actionButton}>
                      <Text style={styles.actionButtonText}>É a mesma atividade</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => answer(item, 'distinct')} style={styles.actionButton}>
                      <Text style={styles.actionButtonText}>São atividades diferentes</Text>
                    </Pressable>
                    <Pressable accessibilityRole="button" onPress={() => setOpenKey(null)} style={styles.laterButton}>
                      <Text style={styles.laterButtonText}>Responder depois</Text>
                    </Pressable>
                  </View>
                )}
              </View>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  notice: { flexDirection: 'row', alignItems: 'center', backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.small, paddingVertical: HomeSpace.small, paddingHorizontal: HomeSpace.related, marginBottom: HomeSpace.related, ...HomeBorder.card },
  noticeDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: HomeColors.warning, marginRight: HomeSpace.small },
  noticeText: { ...HomeTypography.label, color: HomeColors.textPrimary, flex: 1 },
  noticeAction: { ...HomeTypography.label, color: HomeColors.panzeriInteraction },
  section: { paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 },
  sectionTitle: { ...HomeTypography.label, color: HomeColors.textSecondary, textTransform: 'uppercase', letterSpacing: 0.6, marginBottom: HomeSpace.small },
  sectionMessage: { ...HomeTypography.body, color: HomeColors.textSecondary, marginBottom: HomeSpace.small },
  pendingCard: { backgroundColor: HomeColors.surface, borderRadius: HomeRadius.small, marginBottom: HomeSpace.small, ...HomeBorder.card },
  pendingRow: { flexDirection: 'row', alignItems: 'center', padding: HomeSpace.related },
  pendingRowTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  pendingRowSub: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginTop: 2 },
  pendingBody: { paddingHorizontal: HomeSpace.related, paddingBottom: HomeSpace.related, ...HomeBorder.divider },
  pendingTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary, marginTop: HomeSpace.related },
  pendingText: { ...HomeTypography.body, color: HomeColors.textPrimary, marginTop: HomeSpace.small, lineHeight: 21 },
  pendingHint: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginTop: HomeSpace.small, lineHeight: 16 },
  observationRow: { flexDirection: 'row', flexWrap: 'wrap', gap: HomeSpace.small, marginTop: HomeSpace.related },
  observationCard: { flexGrow: 1, flexBasis: 140, backgroundColor: HomeColors.surfaceSecondary, borderRadius: HomeRadius.small, padding: HomeSpace.related },
  observationSource: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  observationChannel: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginBottom: HomeSpace.micro },
  observationLine: { ...HomeTypography.body, color: HomeColors.textPrimary, marginTop: 2 },
  actions: { marginTop: HomeSpace.related, gap: HomeSpace.small },
  actionButton: { borderWidth: 1, borderColor: HomeColors.panzeriInteraction, borderRadius: HomeRadius.small, paddingVertical: HomeSpace.related, alignItems: 'center' },
  actionButtonText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },
  laterButton: { paddingVertical: HomeSpace.small, alignItems: 'center' },
  laterButtonText: { ...HomeTypography.label, color: HomeColors.textSecondary },
});
