import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PRColors } from '../../theme/tokens';

// Hub central de "Dispositivos e integracoes" (Etapa 2, 08/10/2026).
// Nao ha navegacao por fabricante: lista e detalhe sao genericos e dirigidos pelo catalogo do backend
// (GET /me/integrations). O App.tsx so registra QUAL conteudo existente abre para cada id (screens);
// fabricante novo = entrada no catalogo do servidor + (se houver conexao no app) uma entrada em screens.

export type IntegrationAvailability = 'available' | 'preparing' | 'unavailable';
export type IntegrationPlatform = 'web' | 'android' | 'ios_native';

export interface IntegrationCatalogEntry {
  id: string;
  name: string;
  summary: string;
  availability: IntegrationAvailability;
  platforms: IntegrationPlatform[];
  capabilities: { receiveActivities: boolean; sendWorkouts: boolean };
  connection: { state: 'connected' | 'disconnected' | 'not_applicable' };
}

export type IntegrationScreens = Record<string, () => React.ReactNode>;

const PLATFORM_LABEL: Record<IntegrationPlatform, string> = {
  web: 'navegador (PWA)',
  android: 'app Android',
  ios_native: 'app nativo do iPhone',
};

function currentPlatform(): IntegrationPlatform {
  if (Platform.OS === 'web') return 'web';
  return Platform.OS === 'ios' ? 'ios_native' : 'android';
}

function availabilityLabel(entry: IntegrationCatalogEntry) {
  if (entry.availability === 'preparing') return 'Em validação';
  if (entry.availability === 'unavailable') return 'Indisponível no momento';
  if (entry.connection.state === 'connected') return 'Conectado';
  return 'Não conectado';
}

function badgeColor(entry: IntegrationCatalogEntry) {
  if (entry.availability === 'available' && entry.connection.state === 'connected') return PRColors.success;
  if (entry.availability === 'available') return PRColors.ocean;
  return PRColors.slate;
}

function capabilityLines(entry: IntegrationCatalogEntry) {
  if (entry.availability !== 'available' && entry.availability !== 'preparing') return [];
  const lines: string[] = [];
  if (entry.capabilities.receiveActivities) lines.push('Recebe suas atividades no Panzeri Run');
  if (entry.capabilities.sendWorkouts) lines.push('Envia treinos estruturados ao relógio');
  return lines;
}

export function IntegrationsHub({
  accessToken,
  apiUrl,
  screens,
  initialProviderId,
  fallback = [],
}: {
  accessToken: string;
  apiUrl: string;
  screens: IntegrationScreens;
  initialProviderId?: string;
  // Fabricantes com conexao ja existente, exibidos so' se o catalogo falhar (sem afirmar estado).
  fallback?: Array<{ id: string; name: string }>;
}) {
  const [providers, setProviders] = useState<IntegrationCatalogEntry[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialProviderId ?? null);
  const platform = currentPlatform();

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const response = await fetch(`${apiUrl}/me/integrations`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!response.ok) throw new Error('status');
      const data = (await response.json()) as { providers: IntegrationCatalogEntry[] };
      setProviders(data.providers);
    } catch {
      setFailed(true);
    }
  }, [accessToken, apiUrl]);

  useEffect(() => { void load(); }, [load]);

  if (failed && !providers) {
    // Catalogo fora do ar: o aluno continua alcancando as conexoes que ja existem (cada tela consulta o proprio
    // status). Nenhuma disponibilidade/estado e afirmado aqui; so os fabricantes que tem tela no app.
    const fallbackScreen = selectedId ? screens[selectedId] : undefined;
    if (selectedId && fallbackScreen) {
      return (
        <View style={styles.wrap}>
          <Pressable onPress={() => setSelectedId(null)} accessibilityRole="button">
            <Text style={styles.back}>← Dispositivos e integrações</Text>
          </Pressable>
          {fallbackScreen()}
        </View>
      );
    }
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Integrações</Text>
        <Text style={styles.title}>Dispositivos e integrações</Text>
        <Text style={styles.hint}>Não consegui carregar a lista completa agora. Suas conexões abaixo continuam acessíveis.</Text>
        {fallback.filter((item) => screens[item.id]).map((item) => (
          <Pressable key={item.id} style={styles.row} onPress={() => setSelectedId(item.id)} accessibilityRole="button">
            <Text style={[styles.cardTitle, { flex: 1 }]}>{item.name}</Text>
            <Ionicons name="chevron-forward" size={20} color={PRColors.slate} />
          </Pressable>
        ))}
        <Pressable style={styles.button} onPress={() => void load()} accessibilityRole="button">
          <Text style={styles.buttonText}>Tentar novamente</Text>
        </Pressable>
      </View>
    );
  }
  if (!providers) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Integrações</Text>
        <Text style={styles.title}>Dispositivos e integrações</Text>
        <ActivityIndicator />
      </View>
    );
  }

  const selected = selectedId ? providers.find((entry) => entry.id === selectedId) ?? null : null;
  if (selected) {
    const platformOk = selected.platforms.includes(platform);
    const render = screens[selected.id];
    const lines = capabilityLines(selected);
    return (
      <View style={styles.wrap}>
        <Pressable onPress={() => { setSelectedId(null); void load(); }} accessibilityRole="button">
          <Text style={styles.back}>← Dispositivos e integrações</Text>
        </Pressable>
        <View style={styles.card}>
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle}>{selected.name}</Text>
            <View style={[styles.badge, { borderColor: badgeColor(selected) }]}>
              <Text style={[styles.badgeText, { color: badgeColor(selected) }]}>{availabilityLabel(selected)}</Text>
            </View>
          </View>
          <Text style={styles.hint}>{selected.summary}</Text>
          {lines.map((line) => <Text key={line} style={styles.hint}>• {line}</Text>)}
          {!platformOk && selected.availability !== 'unavailable' ? (
            <Text style={styles.hint}>Disponível somente no {selected.platforms.map((item) => PLATFORM_LABEL[item]).join(' ou ')}.</Text>
          ) : null}
        </View>
        {selected.availability !== 'unavailable' && platformOk && render ? render() : null}
      </View>
    );
  }

  return (
    <View style={styles.wrap}>
      <Text style={styles.label}>Integrações</Text>
      <Text style={styles.title}>Dispositivos e integrações</Text>
      <Text style={styles.hint}>Conecte o relógio ou o aplicativo que você usa para treinar.</Text>
      {providers.map((entry) => (
        <Pressable key={entry.id} style={styles.row} onPress={() => setSelectedId(entry.id)} accessibilityRole="button">
          <View style={{ flex: 1, gap: 4 }}>
            <Text style={styles.cardTitle}>{entry.name}</Text>
            <Text style={[styles.badgeText, { color: badgeColor(entry) }]}>{availabilityLabel(entry)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={20} color={PRColors.slate} />
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 16 },
  label: { color: PRColors.ocean, fontSize: 13, fontWeight: '800', textTransform: 'uppercase' },
  title: { color: '#111827', fontSize: 26, fontWeight: '800' },
  hint: { color: '#475569', fontSize: 13, lineHeight: 18 },
  back: { color: PRColors.ocean, fontSize: 14, fontWeight: '700' },
  row: {
    minHeight: 64,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#dbe4ea',
    backgroundColor: '#ffffff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  card: { borderRadius: 8, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 10 },
  cardHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' },
  cardTitle: { color: '#111827', fontSize: 17, fontWeight: '800' },
  badge: { borderWidth: 1, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3 },
  badgeText: { fontSize: 12, fontWeight: '800' },
  button: { minHeight: 48, borderRadius: 8, borderWidth: 1, borderColor: PRColors.ocean, backgroundColor: '#ffffff', alignItems: 'center', justifyContent: 'center' },
  buttonText: { color: PRColors.ocean, fontWeight: '800', fontSize: 15 },
});
