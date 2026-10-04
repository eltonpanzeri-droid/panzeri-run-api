import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HomeColors } from './homeTheme';

// Bottom navigation (30/09/2026, ordem fechada) — o app NÃO tinha bottom nav até agora (navegação
// era só o menu hambúrguer, AppMenu em App.tsx). Reaproveita o MESMO mecanismo de navegação já
// existente (state `activeTab` + `setActiveTab`) — nenhuma lib de navegação nova, nenhuma rota
// nova fora do que já existe. O menu hambúrguer continua existindo pros itens que não cabem aqui
// (histórico, Strava, prova-alvo, etc.) — nunca apagamos funcionalidade, só adicionamos os
// destinos primários visíveis por padrão.
//
// BLOCO 3 (04/10/2026) — Evolução e Conquistas saíram daqui: seu conteúdo já está incorporado na
// Home ("Seu progresso"/"Conquistas", ver home/HomeScreen.tsx) com link "ver mais"/"ver todas" para
// as telas completas (ainda existem, só não são mais destino de primeiro nível). Os 2 espaços
// liberados viram Perfil (contexto esportivo atual) e Conta (identidade/assinatura/acesso) — a
// separação pedida pelo Bloco 3. Nenhuma funcionalidade foi removida, só a redundância de navegação.

export type BottomNavTab = 'home' | 'week' | 'profile' | 'conta';

const ITEMS: Array<{ tab: BottomNavTab; label: string; icon: keyof typeof Ionicons.glyphMap; activeIcon: keyof typeof Ionicons.glyphMap }> = [
  { tab: 'home', label: 'Início', icon: 'home-outline', activeIcon: 'home' },
  { tab: 'week', label: 'Treinos', icon: 'calendar-outline', activeIcon: 'calendar' },
  { tab: 'profile', label: 'Perfil', icon: 'person-outline', activeIcon: 'person' },
  { tab: 'conta', label: 'Conta', icon: 'settings-outline', activeIcon: 'settings' },
];

export function BottomNav({ activeTab, onChange, bottomInset }: { activeTab: string; onChange: (tab: BottomNavTab) => void; bottomInset: number }) {
  return (
    <View style={[styles.bar, { paddingBottom: Math.max(bottomInset, 10), height: 64 + Math.max(bottomInset, 10) }]}>
      {ITEMS.map((item) => {
        const active = activeTab === item.tab;
        return (
          <Pressable
            key={item.tab}
            onPress={() => onChange(item.tab)}
            hitSlop={8}
            style={({ pressed }) => [styles.item, pressed && styles.itemPressed]}
            accessibilityRole="button"
            accessibilityLabel={item.label}
            accessibilityState={{ selected: active }}
          >
            <Ionicons name={active ? item.activeIcon : item.icon} size={22} color={active ? HomeColors.panzeriInteraction : HomeColors.textTertiary} />
            <Text style={[styles.label, active && styles.labelActive]}>{item.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    backgroundColor: HomeColors.surface,
    borderTopWidth: 1,
    borderTopColor: HomeColors.divider,
    paddingTop: 8,
    ...Platform.select({ web: { boxShadow: '0 -2px 12px rgba(20,45,75,0.05)' } as never, default: {} }),
  },
  item: {
    flex: 1,
    minHeight: 44,
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: 4,
    paddingVertical: 2,
  },
  itemPressed: {
    transform: [{ scale: 0.985 }],
  },
  label: {
    fontSize: 11,
    fontWeight: '600',
    color: HomeColors.textTertiary,
  },
  labelActive: {
    color: HomeColors.panzeriInteraction,
  },
});
