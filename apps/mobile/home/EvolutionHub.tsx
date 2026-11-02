import React, { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { Text } from '../src/PtText';
import { Ionicons } from '@expo/vector-icons';
import { HomeBorder, HomeColors, HomeRadius, HomeSpace, HomeTypography } from './homeTheme';
import { FEELING_DOMAINS, FeelingDomain } from './insights';
import { FeelingsDetailScreen } from './FeelingsDetailScreen';
import { PainArea } from './PainArea';
import { LoadSection } from './LoadSection';
import { WearableSleepSection } from './WearableSleepSection';
import { AdherenceWeekly } from './AdherenceSection';

// Esqueleto da nova "Evolução" (02/11/2026, ordem de Elton): seis áreas em vez de uma página longa. Neste lote NADA é calculado aqui: cada área só abre o conteúdo
// que já existe (mesma leitura do servidor e mesmos textos). Indicadores novos entram nas áreas nos próximos lotes. Sem diagnóstico: o aviso do topo diz isso.

export type ProgressFocus = 'training' | 'adherence';

type View_ = 'hub' | 'training' | 'load' | 'sleep' | 'wellbeing' | 'readiness' | 'response' | 'weekly' | 'pain' | 'adherence';

const AREAS: Array<{ id: Exclude<View_, 'hub' | 'readiness' | 'response' | 'weekly'>; title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }> = [
  { id: 'training', title: 'Evolução do treinamento', subtitle: 'Volume, ritmo e cadência', icon: 'trending-up-outline' },
  { id: 'load', title: 'Resposta à carga', subtitle: 'Esforço percebido e carga de treino', icon: 'barbell-outline' },
  { id: 'sleep', title: 'Sono e recuperação', subtitle: 'Como foram suas noites antes dos treinos', icon: 'moon-outline' },
  { id: 'wellbeing', title: 'Bem-estar', subtitle: 'Cansaço, estresse, motivação e resposta do corpo', icon: 'heart-outline' },
  { id: 'pain', title: 'Dor', subtitle: 'Dor por treino e relatos', icon: 'bandage-outline' },
  { id: 'adherence', title: 'Aderência', subtitle: 'Treinos prescritos × realizados', icon: 'ribbon-outline' },
];

// Texto do topo: melhorado a partir da proposta de Elton. Passa pela revisão do advogado junto com os demais textos de saúde.
const TOP_NOTICE = 'Os indicadores desta área descrevem padrões e mudanças nos seus próprios registros. Eles não são diagnóstico médico. O Panzeri Run analisa vários indicadores em conjunto para individualizar seus treinos e orientar sua evolução.';

function BackRow({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.back}>
      <Ionicons name="chevron-back" size={16} color={HomeColors.panzeriInteraction} />
      <Text style={styles.backText}>{label}</Text>
    </Pressable>
  );
}

function AreaCard({ title, subtitle, icon, onPress }: { title: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.card, HomeBorder.card]}>
      <View style={styles.cardIcon}><Ionicons name={icon} size={22} color={HomeColors.panzeriInteraction} /></View>
      <View style={{ flex: 1 }}>
        <Text style={styles.cardTitle}>{title}</Text>
        <Text style={styles.cardSubtitle}>{subtitle}</Text>
      </View>
      <Ionicons name="chevron-forward" size={18} color={HomeColors.textTertiary} />
    </Pressable>
  );
}

export function EvolutionHub({
  accessToken,
  renderProgress,
  onOpenRecovery,
  onOpenPainReport,
}: {
  accessToken: string;
  /** A tela "Evolução objetiva" atual (App.tsx), com o recorte pedido: so' treinamento ou so' aderencia. */
  renderProgress: (focus: ProgressFocus) => React.ReactNode;
  onOpenRecovery: () => void;
  onOpenPainReport: () => void;
}) {
  const [view, setView] = useState<View_>('hub');

  if (view === 'hub') {
    return (
      <View style={styles.container}>
        <Text style={styles.kicker}>EVOLUÇÃO</Text>
        <Text style={styles.title}>Sua evolução</Text>
        <Text style={styles.subtitle}>Entenda como seu corpo e seu treinamento vêm respondendo ao longo do tempo.</Text>
        <View style={styles.notice}>
          <Text style={styles.noticeTitle}>Como interpretar seus resultados</Text>
          <Text style={styles.noticeText}>{TOP_NOTICE}</Text>
        </View>
        {AREAS.map((a) => <AreaCard key={a.id} title={a.title} subtitle={a.subtitle} icon={a.icon} onPress={() => setView(a.id)} />)}
      </View>
    );
  }

  if (view === 'training' || view === 'adherence') {
    return (
      <View style={styles.container}>
        <BackRow label="Evolução" onPress={() => setView('hub')} />
        {renderProgress(view)}
        {view === 'adherence' ? <AdherenceWeekly accessToken={accessToken} /> : null}
      </View>
    );
  }

  if (view === 'load' || view === 'sleep') {
    const domain: FeelingDomain = view === 'load' ? 'effort' : 'sleep';
    return (
      <View style={styles.container}>
        <FeelingsDetailScreen accessToken={accessToken} domain={domain} onBack={() => setView('hub')} backLabel="Evolução" />
        {view === 'load' ? <LoadSection accessToken={accessToken} /> : null}
        {view === 'sleep' ? <WearableSleepSection accessToken={accessToken} /> : null}
        {view === 'sleep' ? (
          <Pressable onPress={onOpenRecovery} style={[styles.card, HomeBorder.card]}>
            <View style={styles.cardIcon}><Ionicons name="pulse-outline" size={22} color={HomeColors.panzeriInteraction} /></View>
            <View style={{ flex: 1 }}>
              <Text style={styles.cardTitle}>Dados do seu relógio</Text>
              <Text style={styles.cardSubtitle}>Sono, variabilidade e frequência cardíaca de repouso, em "Minha recuperação"</Text>
            </View>
            <Ionicons name="chevron-forward" size={18} color={HomeColors.textTertiary} />
          </Pressable>
        ) : null}
      </View>
    );
  }

  if (view === 'wellbeing') {
    return (
      <View style={styles.container}>
        <BackRow label="Evolução" onPress={() => setView('hub')} />
        <Text style={styles.title}>Bem-estar</Text>
        <Text style={styles.subtitle}>Como você chega aos treinos e como responde a eles.</Text>
        {(['readiness', 'response', 'weekly'] as const).map((d) => (
          <AreaCard key={d} title={FEELING_DOMAINS[d].title} subtitle={FEELING_DOMAINS[d].subtitle} icon={d === 'readiness' ? 'battery-half-outline' : d === 'response' ? 'happy-outline' : 'calendar-outline'} onPress={() => setView(d)} />
        ))}
      </View>
    );
  }

  if (view === 'readiness' || view === 'response' || view === 'weekly') {
    return (
      <View style={styles.container}>
        <FeelingsDetailScreen accessToken={accessToken} domain={view} onBack={() => setView('wellbeing')} backLabel="Bem-estar" />
      </View>
    );
  }

  // 'pain': grafico de dor por treino + relatos avulsos (02/11/2026; treino registrado sem relato de dor = zero, regra de Elton).
  return (
    <View style={styles.container}>
      <BackRow label="Evolução" onPress={() => setView('hub')} />
      <PainArea accessToken={accessToken} onOpenPainReport={onOpenPainReport} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: HomeSpace.related },
  kicker: { ...HomeTypography.label, color: HomeColors.panzeriInteraction, letterSpacing: 0.5 },
  title: { ...HomeTypography.greeting, color: HomeColors.textPrimary },
  subtitle: { ...HomeTypography.body, color: HomeColors.textSecondary, marginTop: -6 },
  back: { flexDirection: 'row', alignItems: 'center', gap: 2, paddingTop: HomeSpace.small },
  backText: { ...HomeTypography.bodyMedium, color: HomeColors.panzeriInteraction },
  notice: { backgroundColor: HomeColors.surfaceHighlight, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component, gap: 6 },
  noticeTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  noticeText: { ...HomeTypography.body, color: HomeColors.textSecondary, lineHeight: 21 },
  card: { flexDirection: 'row', alignItems: 'center', gap: HomeSpace.related, backgroundColor: HomeColors.surface, borderRadius: HomeRadius.cardLarge, padding: HomeSpace.component },
  cardIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: HomeColors.surfaceHighlight, alignItems: 'center', justifyContent: 'center' },
  cardTitle: { ...HomeTypography.bodyMedium, color: HomeColors.textPrimary },
  cardSubtitle: { ...HomeTypography.tertiary, color: HomeColors.textSecondary, marginTop: 2, lineHeight: 16 },
  button: { backgroundColor: HomeColors.panzeriInteraction, borderRadius: HomeRadius.small, paddingVertical: 12, alignItems: 'center' },
  buttonText: { ...HomeTypography.bodyMedium, color: '#fff' },
});
