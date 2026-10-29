import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Linking, Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../PtText';
import { PRColors } from '../../theme/tokens';
import { formatLastSync, HealthConnectStatus, STATUS_LABEL } from './contract';
import { HealthConnectConsent } from './HealthConnectConsent';
import { createNativeHealthConnectGateway } from './gateway';
import { disableBackgroundSync, enableBackgroundSync, isBackgroundSyncRegistered } from './backgroundTask';
import { useHealthConnectSync } from './useHealthConnect';

// Tela do Health Connect dentro de "Dispositivos e integracoes". Conectar pede a autorizacao ao Android; Sincronizar agora le e envia; Desconectar para
// novas leituras (o historico ja' importado NAO e' apagado). Textos objetivos, sem prometer marca especifica.
export function HealthConnectCard({ accessToken, apiUrl }: { accessToken: string; apiUrl: string }) {
  const sync = useHealthConnectSync(accessToken, apiUrl);
  const [status, setStatus] = useState<HealthConnectStatus>('not_connected');
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Leitura em segundo plano: 'on' = acesso do Android concedido E tarefa registrada.
  const [background, setBackground] = useState<'unknown' | 'on' | 'off'>('unknown');
  const mounted = useRef(true);

  const refreshBackground = useCallback(async () => {
    try {
      const access = (await createNativeHealthConnectGateway().hasBackgroundAccess?.()) ?? false;
      const registered = await isBackgroundSyncRegistered();
      if (mounted.current) setBackground(access && registered ? 'on' : 'off');
    } catch { if (mounted.current) setBackground('off'); }
  }, []);
  useEffect(() => { void refreshBackground(); }, [refreshBackground]);

  const allowBackground = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const granted = (await createNativeHealthConnectGateway().requestBackgroundAccess?.()) ?? false;
      if (granted) { await enableBackgroundSync(); setNote('Leitura em segundo plano ligada. O Android decide os horários: em geral a cada algumas horas, com bateria e rede disponíveis.'); }
      else setNote('O Android não liberou a leitura em segundo plano. Você pode tentar de novo quando quiser.');
    } catch { setNote('Não foi possível ligar a leitura em segundo plano agora.'); }
    finally { setBusy(false); await refreshBackground(); }
  };
  const stopBackground = async () => {
    if (busy) return;
    setBusy(true);
    try { await disableBackgroundSync(); setNote('Leitura em segundo plano desligada. O Panzeri Run volta a ler só quando você abre o aplicativo.'); }
    finally { setBusy(false); await refreshBackground(); }
  };

  const refresh = useCallback(async () => {
    if (!sync) return;
    const view = await sync.view();
    if (!mounted.current) return;
    setStatus(view.status);
    setLastSyncAt(view.lastSyncAt);
    setNote(view.missingOptional.length ? 'Distância ou frequência cardíaca não autorizadas: essas atividades serão importadas sem esses dados.' : null);
  }, [sync]);

  useEffect(() => { mounted.current = true; void refresh(); return () => { mounted.current = false; }; }, [refresh]);

  const runSync = async () => {
    if (!sync || busy) return;
    setBusy(true);
    setStatus('syncing');
    // Toque em "Sincronizar agora": unico caso em que o Android pode abrir a janela de confirmacao do percurso GPS de um exercicio.
    const result = await sync.syncNow({ interactive: true });
    if (!mounted.current) return;
    setBusy(false);
    setLastSyncAt(result.lastSyncAt);
    setStatus(result.status === 'skipped' ? 'connected' : result.status);
    setNote(result.status === 'done'
      ? `${result.created + result.updated} atividade(s) nova(s) ou atualizada(s); ${result.alreadyImported} já estavam importadas.${result.healthStored ? ` ${result.healthStored} registro(s) de saúde recebido(s).` : ''}${result.missingOptional.length ? ' Alguns dados opcionais não estão autorizados.' : ''}${result.failedCategories.length ? ' Algumas categorias não puderam ser lidas agora e serão tentadas de novo.' : ''}`
      : null);
  };

  const connect = async () => {
    if (!sync || busy) return;
    setBusy(true);
    const result = await sync.connect();
    if (!mounted.current) return;
    setBusy(false);
    setStatus(result.status);
    if (result.status === 'connected') await runSync();
  };

  // Depois de salvar as autorizacoes no Panzeri Run: pede ao Android SO' as permissoes das categorias marcadas e sincroniza. Sem nenhuma categoria marcada, nada e' pedido.
  const onConsentSaved = async () => {
    if (!sync) return;
    const result = await sync.connect();
    if (!mounted.current) return;
    setStatus(result.status);
    if (result.status === 'connected') await runSync();
    else await refresh();
  };

  const disconnect = async () => {
    if (!sync || busy) return;
    setBusy(true);
    await sync.disconnect();
    await disableBackgroundSync(); // sem conexao nao ha o que ler em segundo plano
    if (!mounted.current) return;
    setBusy(false);
    setNote('Desconectado. As atividades já importadas continuam no seu histórico. Para remover também a permissão do Android, use os ajustes do Health Connect.');
    setStatus('not_connected');
  };

  if (!sync) return <Text style={styles.hint}>Disponível somente no app Android.</Text>;
  const connected = status === 'connected' || status === 'done' || status === 'syncing' || status === 'error' || status === 'insufficient_permissions';
  const last = formatLastSync(lastSyncAt);
  const color = status === 'error' || status === 'insufficient_permissions' || status === 'unavailable' ? '#b91c1c' : status === 'not_connected' || status === 'needs_consent' ? PRColors.slate : PRColors.success;

  return (
    <View style={{ gap: 16 }}>
    <View style={styles.card}>
      <View style={styles.header}>
        <Text style={styles.title}>Estado</Text>
        <View style={[styles.badge, { borderColor: color }]}><Text style={[styles.badgeText, { color }]}>{STATUS_LABEL[status]}</Text></View>
      </View>
      {status === 'syncing' ? <ActivityIndicator /> : null}
      <Text style={styles.hint}>{last ? `Última sincronização: ${last}` : 'Nenhuma sincronização concluída ainda.'}</Text>
      {note ? <Text style={styles.hint}>{note}</Text> : null}
      {status === 'unavailable' ? <Text style={styles.hint}>Instale ou atualize o Health Connect na Google Play para usar esta integração.</Text> : null}
      <Text style={styles.hint}>Usa Galaxy Watch ou Samsung Health? No app Samsung Health, abra Configurações → Health Connect e ligue o compartilhamento dos dados. Sem isso o Health Connect fica vazio.</Text>
      {status === 'insufficient_permissions' ? <Text style={styles.hint}>Permita no Android a leitura dos dados que você autorizou abaixo para que cheguem ao Panzeri Run.</Text> : null}
      {status === 'needs_consent' ? <Text style={styles.hint}>Escolha abaixo o que você quer compartilhar. Só depois disso o Android pede as permissões.</Text> : null}
      {status === 'error' ? <Text style={styles.hint}>Não foi possível sincronizar agora. Suas atividades não foram perdidas; tente novamente.</Text> : null}
      {!connected && status !== 'unavailable' ? (
        <Pressable style={[styles.primary, busy && styles.disabled]} disabled={busy} onPress={connect} accessibilityRole="button"><Text style={styles.primaryText}>Permitir no Android</Text></Pressable>
      ) : null}
      {status === 'insufficient_permissions' ? (
        <Pressable style={styles.secondary} onPress={connect} accessibilityRole="button"><Text style={styles.secondaryText}>Autorizar novamente</Text></Pressable>
      ) : null}
      {connected && status !== 'insufficient_permissions' ? (
        <Pressable style={[styles.primary, (busy || status === 'syncing') && styles.disabled]} disabled={busy || status === 'syncing'} onPress={runSync} accessibilityRole="button"><Text style={styles.primaryText}>Sincronizar agora</Text></Pressable>
      ) : null}
      {connected ? (
        <Pressable style={[styles.secondary, busy && styles.disabled]} disabled={busy} onPress={disconnect} accessibilityRole="button"><Text style={styles.secondaryText}>Desconectar</Text></Pressable>
      ) : null}
      {connected ? (
        <View style={{ gap: 6 }}>
          <Text style={styles.hint}>{background === 'on' ? 'Leitura em segundo plano: ligada. Os dados chegam mesmo sem abrir o aplicativo.' : 'Leitura em segundo plano: desligada. Hoje os dados só chegam quando você abre o aplicativo.'}</Text>
          {background === 'on'
            ? <Pressable style={[styles.secondary, busy && styles.disabled]} disabled={busy} onPress={stopBackground} accessibilityRole="button"><Text style={styles.secondaryText}>Desligar leitura em segundo plano</Text></Pressable>
            : <Pressable style={[styles.secondary, busy && styles.disabled]} disabled={busy} onPress={allowBackground} accessibilityRole="button"><Text style={styles.secondaryText}>Permitir leitura em segundo plano</Text></Pressable>}
        </View>
      ) : null}
      <Pressable onPress={() => { void Linking.openSettings().catch(() => undefined); }} accessibilityRole="link"><Text style={styles.link}>Gerenciar permissões no Android</Text></Pressable>
    </View>
    <HealthConnectConsent apiUrl={apiUrl} accessToken={accessToken} onSaved={onConsentSaved} />
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 8, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  title: { color: '#111827', fontSize: 17, fontWeight: '800' },
  hint: { color: '#475569', fontSize: 13, lineHeight: 18 },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  primary: { minHeight: 48, borderRadius: 8, backgroundColor: PRColors.ocean, alignItems: 'center', justifyContent: 'center' },
  primaryText: { color: '#ffffff', fontWeight: '800', fontSize: 15 },
  secondary: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: PRColors.ocean, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: PRColors.ocean, fontWeight: '800', fontSize: 15 },
  disabled: { opacity: 0.5 },
  link: { color: PRColors.ocean, fontSize: 13, fontWeight: '700' },
});
