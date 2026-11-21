import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import * as Sharing from 'expo-sharing';
import { Text } from '../PtText';
import { RouteMap, ROUTE_COLOR } from './RouteMap';
import { RouteData, cardStats, replayPosition } from './route';

// Cartao de compartilhamento e replay do trajeto (21/11/2026, Elton): qualquer treino com percurso (gravado no Panzeri Run ou vindo de um relogio) vira um cartao com a marca do Panzeri Run para a aluna
// postar onde quiser. O mapa mostra o percurso do inicio ao fim, exatamente como foi (nenhum trecho e' escondido). Credito do fabricante so' onde ele exige (Garmin: "Garmin [modelo]"; Polar), em toda imagem.
// O "video" do trajeto e' o replay animado: a aluna grava a tela do celular para postar. Compartilhar e' um ato dela; nada e' publicado pelo Panzeri Run.

export type ShareSource = { activityLogId: string; route?: undefined } | { route: RouteData; activityLogId?: undefined };
type Variant = 'map' | 'clear';
const CARD_WIDTH = 340;

export function ShareActivityScreen({ apiUrl, accessToken, source, onClose }: { apiUrl: string; accessToken: string; source: ShareSource; onClose: () => void }) {
  const [route, setRoute] = useState<RouteData | null>(source.route ?? null);
  const [loading, setLoading] = useState(!source.route);
  const [variant, setVariant] = useState<Variant>('map');
  const [mapReady, setMapReady] = useState(false);
  const [mode, setMode] = useState<'card' | 'replay'>('card');
  const [canShare, setCanShare] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const cardRef = useRef<View>(null);

  useEffect(() => { void Sharing.isAvailableAsync().then(setCanShare).catch(() => setCanShare(false)); }, []);
  useEffect(() => {
    if (source.route || !source.activityLogId) return undefined;
    let alive = true;
    void (async () => {
      try {
        const response = await fetch(`${apiUrl}/me/activity-reconciliation/${source.activityLogId}/route`, { headers: { Authorization: `Bearer ${accessToken}` } });
        if (!alive) return;
        if (response.ok) setRoute((await response.json()) as RouteData);
        else setMessage('Não consegui abrir este treino agora.');
      } catch { if (alive) setMessage('Sem conexão. Tente de novo.'); } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, [accessToken, apiUrl, source.activityLogId, source.route]);

  const onMapReady = useCallback(() => setMapReady(true), []);
  const share = async () => {
    if (!cardRef.current || busy) return;
    setBusy(true); setMessage(null);
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1, result: 'tmpfile' });
      await Sharing.shareAsync(uri, { mimeType: 'image/png', UTI: 'public.png', dialogTitle: 'Compartilhar treino' });
    } catch { setMessage('Não consegui gerar a imagem agora. Tente de novo.'); } finally { setBusy(false); }
  };

  if (loading) return <View style={styles.center}><ActivityIndicator color="#FFFFFF" /></View>;
  if (!route || route.points.length < 2) {
    return (
      <View style={styles.center}>
        <Text style={styles.white}>Este treino não tem percurso para mostrar.</Text>
        <Text style={styles.hint}>O percurso só existe quando o treino foi gravado com GPS e a gravação do percurso está autorizada.</Text>
        {message ? <Text style={styles.hint}>{message}</Text> : null}
        <Pressable style={styles.secondary} onPress={onClose}><Text style={styles.secondaryText}>Fechar</Text></Pressable>
      </View>
    );
  }
  if (mode === 'replay') return <Replay route={route} onClose={() => setMode('card')} />;

  const ready = variant === 'clear' || mapReady;
  return (
    <ScrollView style={styles.page} contentContainerStyle={styles.pageContent}>
      <View style={styles.row}>
        <Pressable style={[styles.chip, variant === 'map' && styles.chipOn]} onPress={() => setVariant('map')}><Text style={[styles.chipText, variant === 'map' && styles.chipTextOn]}>COM FUNDO</Text></Pressable>
        <Pressable style={[styles.chip, variant === 'clear' && styles.chipOn]} onPress={() => setVariant('clear')}><Text style={[styles.chipText, variant === 'clear' && styles.chipTextOn]}>SEM FUNDO</Text></Pressable>
      </View>
      <View style={variant === 'clear' ? styles.checker : undefined}>
        <ShareCard ref={cardRef} route={route} variant={variant} onMapReady={onMapReady} />
      </View>
      {canShare ? (
        <Pressable style={[styles.primary, (!ready || busy) && styles.disabled]} disabled={!ready || busy} onPress={() => void share()} accessibilityRole="button">
          {busy || !ready ? <ActivityIndicator color="#0B3D5C" /> : null}
          <Text style={styles.primaryText}>{ready ? 'Compartilhar' : 'Carregando o mapa…'}</Text>
        </Pressable>
      ) : null}
      <Pressable style={styles.secondary} onPress={() => setMode('replay')} accessibilityRole="button"><Text style={styles.secondaryText}>▶ Replay do trajeto</Text></Pressable>
      {message ? <Text style={styles.hint}>{message}</Text> : null}
      <Pressable style={styles.link} onPress={onClose}><Text style={styles.linkText}>Fechar</Text></Pressable>
    </ScrollView>
  );
}

// O cartao em si (a imagem que e' compartilhada). Tamanho fixo na proporcao de um story; "sem fundo" e' transparente, com o trajeto desenhado (sem mapa) para servir de adesivo.
const ShareCard = React.forwardRef<View, { route: RouteData; variant: Variant; onMapReady: () => void }>(function ShareCard({ route, variant, onMapReady }, ref) {
  const stats = cardStats(route);
  const clear = variant === 'clear';
  return (
    <View ref={ref} collapsable={false} style={[styles.card, clear ? styles.cardClear : styles.cardDark]}>
      <View style={styles.cardHead}>
        <View style={styles.brand}>
          <Image source={require('../../assets/brand/icon-ios.png')} style={styles.logo} />
          <Text style={styles.brandText}>PANZERI RUN</Text>
        </View>
        <Text style={styles.cardDate}>{stats.date}</Text>
      </View>
      <Text style={styles.bigNumber}>{stats.distance}<Text style={styles.bigUnit}> km</Text></Text>
      <View style={styles.mapWrap}>
        <RouteMap points={route.points} height={260} forceSketch={clear} lineColor={ROUTE_COLOR} onReady={onMapReady} />
      </View>
      <View style={styles.stats}>
        <View><Text style={styles.statValue}>{stats.time}</Text><Text style={styles.statLabel}>TEMPO</Text></View>
        <View><Text style={styles.statValue}>{stats.pace}</Text><Text style={styles.statLabel}>RITMO</Text></View>
        <View><Text style={styles.statValue}>{stats.elevation}</Text><Text style={styles.statLabel}>ELEVAÇÃO</Text></View>
      </View>
      {route.attribution ? <Text style={styles.attribution}>{route.attribution}</Text> : null}
    </View>
  );
});

// Replay: o trajeto se desenha do inicio ao fim em 15 ou 30 segundos, com a posicao andando. A aluna grava a tela para postar como video. O credito do fabricante fica sempre visivel.
function Replay({ route, onClose }: { route: RouteData; onClose: () => void }) {
  const [seconds, setSeconds] = useState<15 | 30>(15);
  const [fraction, setFraction] = useState(0);
  const [running, setRunning] = useState(false);
  const startedAt = useRef(0);
  const stats = cardStats(route);

  useEffect(() => {
    if (!running) return undefined;
    startedAt.current = Date.now();
    const timer = setInterval(() => {
      const f = Math.min(1, (Date.now() - startedAt.current) / (seconds * 1000));
      setFraction(f);
      if (f >= 1) { clearInterval(timer); setRunning(false); }
    }, 50);
    return () => clearInterval(timer);
  }, [running, seconds]);

  const position = replayPosition(route.points, fraction);
  return (
    <View style={styles.replay}>
      <View style={styles.cardHead}>
        <View style={styles.brand}>
          <Image source={require('../../assets/brand/icon-ios.png')} style={styles.logo} />
          <Text style={styles.brandText}>PANZERI RUN</Text>
        </View>
        <Text style={styles.cardDate}>{stats.date}</Text>
      </View>
      <Text style={styles.bigNumber}>{stats.distance}<Text style={styles.bigUnit}> km</Text></Text>
      <RouteMap points={route.points} height={420} upTo={fraction} marker={position && fraction > 0 && fraction < 1 ? { lat: position.lat, lon: position.lon } : null} />
      <View style={styles.stats}>
        <View><Text style={styles.statValue}>{stats.time}</Text><Text style={styles.statLabel}>TEMPO</Text></View>
        <View><Text style={styles.statValue}>{stats.pace}</Text><Text style={styles.statLabel}>RITMO</Text></View>
        <View><Text style={styles.statValue}>{stats.elevation}</Text><Text style={styles.statLabel}>ELEVAÇÃO</Text></View>
      </View>
      {route.attribution ? <Text style={styles.attribution}>{route.attribution}</Text> : null}
      {!running ? (
        <View style={styles.controls}>
          <View style={styles.row}>
            <Pressable style={[styles.chip, seconds === 15 && styles.chipOn]} onPress={() => setSeconds(15)}><Text style={[styles.chipText, seconds === 15 && styles.chipTextOn]}>15 SEG</Text></Pressable>
            <Pressable style={[styles.chip, seconds === 30 && styles.chipOn]} onPress={() => setSeconds(30)}><Text style={[styles.chipText, seconds === 30 && styles.chipTextOn]}>30 SEG</Text></Pressable>
          </View>
          <Pressable style={styles.primary} onPress={() => { setFraction(0); setRunning(true); }}><Text style={styles.primaryText}>{fraction >= 1 ? 'Ver de novo' : 'Iniciar replay'}</Text></Pressable>
          <Text style={styles.hint}>Para postar como vídeo, comece a gravar a tela do celular e toque em Iniciar replay.</Text>
          <Pressable style={styles.link} onPress={onClose}><Text style={styles.linkText}>Voltar</Text></Pressable>
        </View>
      ) : null}
    </View>
  );
}

const NAVY = '#071827';
const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: NAVY },
  pageContent: { padding: 16, gap: 14, alignItems: 'center' },
  center: { flex: 1, backgroundColor: NAVY, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 12 },
  white: { color: '#FFFFFF', fontSize: 16, fontWeight: '700', textAlign: 'center' },
  hint: { color: '#94A3B8', fontSize: 12, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 10, justifyContent: 'center' },
  chip: { borderWidth: 1, borderColor: '#475569', borderRadius: 20, paddingVertical: 8, paddingHorizontal: 16 },
  chipOn: { backgroundColor: ROUTE_COLOR, borderColor: ROUTE_COLOR },
  chipText: { color: '#CBD5E1', fontSize: 12, fontWeight: '800', letterSpacing: 1 },
  chipTextOn: { color: '#052E2B' },
  primary: { flexDirection: 'row', gap: 8, alignItems: 'center', justifyContent: 'center', backgroundColor: ROUTE_COLOR, borderRadius: 14, paddingVertical: 14, paddingHorizontal: 32, alignSelf: 'stretch' },
  primaryText: { color: '#052E2B', fontWeight: '800', fontSize: 16 },
  secondary: { alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#64748B', borderRadius: 14, paddingVertical: 12, alignSelf: 'stretch' },
  secondaryText: { color: '#E2E8F0', fontWeight: '700', fontSize: 15 },
  link: { paddingVertical: 8 },
  linkText: { color: '#93C5FD', fontWeight: '700', fontSize: 15 },
  disabled: { opacity: 0.5 },
  checker: { backgroundColor: '#475569', borderRadius: 24, padding: 6 },
  card: { width: CARD_WIDTH, borderRadius: 24, padding: 22, gap: 12 },
  cardDark: { backgroundColor: NAVY, borderWidth: 1, borderColor: '#1E3A5F' },
  cardClear: { backgroundColor: 'transparent' },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  logo: { width: 26, height: 26, borderRadius: 7 },
  brandText: { color: ROUTE_COLOR, fontSize: 14, fontWeight: '800', letterSpacing: 3 },
  cardDate: { color: '#94A3B8', fontSize: 13, fontWeight: '700' },
  bigNumber: { color: '#FFFFFF', fontSize: 64, fontWeight: '800' },
  bigUnit: { fontSize: 28, color: '#CBD5E1' },
  mapWrap: { borderRadius: 16, overflow: 'hidden' },
  stats: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 6 },
  statValue: { color: '#FFFFFF', fontSize: 18, fontWeight: '800' },
  statLabel: { color: '#94A3B8', fontSize: 11, fontWeight: '800', letterSpacing: 1.5 },
  attribution: { color: '#CBD5E1', fontSize: 11, fontWeight: '600', marginTop: 2 },
  replay: { flex: 1, backgroundColor: NAVY, padding: 22, gap: 12 },
  controls: { gap: 12, alignItems: 'center' },
});
