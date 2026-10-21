import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { PRColors } from '../../theme/tokens';

// Tela de assinatura da loja (Apple 3.1.2(c), 21/10/2026): explica ANTES da compra o que a assinatura inclui, mostra o plano REAL cadastrado na loja (nome, preco, periodo e
// teste gratuito so' se existir) e traz renovacao automatica, cobranca pela loja, Termos de Uso, Politica de Privacidade e Restaurar compras. Nada de preco fixo no codigo:
// tudo que e' valor vem do produto que a loja devolve (RevenueCat/StoreKit). O fluxo de compra NAO muda: o botao chama o mesmo handler que ja existia.
//
// Os quatro beneficios abaixo foram conferidos contra o produto atual (21/10/2026): programa semanal personalizado pela IA (Semana), organizacao e progressao ao longo das
// semanas (Semana + Progresso), registro de atividades e visualizacao da evolucao (feedback de treino, integracoes, Progresso/Historico) e atualizacao do programa conforme
// as informacoes e o progresso do aluno (nova semana, mudanca de rotina). NAO se anuncia acompanhamento humano individual, Amazfit/Zepp, Atlas nem recursos futuros.

export interface StorePlanView {
  id: string;
  name: string;
  priceString: string;
  // Ex.: "por mês". null quando a loja nao informou o periodo.
  periodLabel: string | null;
  // So' quando existe oferta de introducao configurada na loja (teste gratuito ou preco promocional).
  introLabel: string | null;
}

export const PAYWALL_BENEFITS: ReadonlyArray<{ icon: keyof typeof Ionicons.glyphMap; title: string; description: string }> = [
  { icon: 'barbell-outline', title: 'Treinos personalizados', description: 'Sessões planejadas de acordo com seu perfil e seus objetivos.' },
  { icon: 'calendar-outline', title: 'Planejamento da sua evolução', description: 'Organização dos treinos e progressão ao longo das semanas.' },
  { icon: 'stats-chart-outline', title: 'Acompanhamento do desempenho', description: 'Registro das atividades e visualização da sua evolução.' },
  { icon: 'sync-outline', title: 'Ajustes no treinamento', description: 'Atualizações do planejamento conforme suas informações e progresso.' },
];

export function paywallTexts(store: 'apple' | 'google') {
  const account = store === 'apple' ? 'Apple' : 'Google';
  const storeName = store === 'apple' ? 'App Store' : 'Google Play';
  return {
    title: 'Seu treinamento começa aqui',
    subtitle: 'Um plano de corrida personalizado para você treinar com organização, consistência e evolução.',
    benefitsHeading: 'O que você recebe na assinatura',
    planHeading: 'Plano',
    renewal: `A assinatura é renovada automaticamente ao final de cada período, salvo cancelamento. Você pode gerenciar ou cancelar a renovação nas configurações da sua conta ${account}.`,
    billing: `Ao confirmar a assinatura, a cobrança será realizada pela ${storeName}.`,
    terms: 'Termos de Uso',
    privacy: 'Política de Privacidade',
    restore: 'Restaurar compras',
    subscribe: (planName: string) => `Assinar ${planName}`,
  };
}

export function StoreSubscriptionPaywall({
  store = Platform.OS === 'ios' ? 'apple' : 'google',
  loadPlans,
  onSubscribe,
  busy,
  message,
  restore,
  onRestored,
  onOpenTerms,
  onOpenPrivacy,
}: {
  store?: 'apple' | 'google';
  // Produtos reais da loja que o fluxo de compra existente consegue comprar (hoje: o plano mensal).
  loadPlans: () => Promise<StorePlanView[]>;
  onSubscribe: () => void;
  busy: boolean;
  message?: string;
  restore: () => Promise<{ status: 'restored' | 'none' | 'error'; message: string }>;
  onRestored: () => void;
  onOpenTerms: () => void;
  onOpenPrivacy: () => void;
}) {
  const t = paywallTexts(store);
  const [plans, setPlans] = useState<StorePlanView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [restoring, setRestoring] = useState(false);
  const [restoreMessage, setRestoreMessage] = useState('');

  const load = useCallback(async () => {
    setFailed(false);
    try {
      const list = await loadPlans();
      if (list.length === 0) { setFailed(true); return; }
      setPlans(list);
      setSelectedId((current) => (current && list.some((plan) => plan.id === current) ? current : list[0].id));
    } catch {
      setFailed(true);
    }
  }, [loadPlans]);

  useEffect(() => {
    void load();
    // A loja pode demorar a responder na primeira abertura: uma segunda tentativa automatica antes de mostrar o erro.
    const retry = setTimeout(() => { if (!plans) void load(); }, 2500);
    return () => clearTimeout(retry);
  }, [load]);

  const selected = plans?.find((plan) => plan.id === selectedId) ?? null;

  return (
    <View style={styles.wrap}>
      <Text style={styles.title} accessibilityRole="header">{t.title}</Text>
      <Text style={styles.subtitle}>{t.subtitle}</Text>

      <View style={styles.card}>
        <Text style={styles.heading} accessibilityRole="header">{t.benefitsHeading}</Text>
        {PAYWALL_BENEFITS.map((benefit) => (
          <View key={benefit.title} style={styles.benefitRow} accessible accessibilityLabel={`${benefit.title}. ${benefit.description}`}>
            <View style={styles.benefitIcon}><Ionicons name={benefit.icon} size={22} color={PRColors.ocean} /></View>
            <View style={styles.benefitText}>
              <Text style={styles.benefitTitle}>{benefit.title}</Text>
              <Text style={styles.benefitDescription}>{benefit.description}</Text>
            </View>
          </View>
        ))}
      </View>

      <View style={styles.card}>
        <Text style={styles.heading} accessibilityRole="header">{plans && plans.length > 1 ? 'Escolha seu plano' : t.planHeading}</Text>
        {!plans && !failed ? <ActivityIndicator accessibilityLabel="Carregando plano" /> : null}
        {failed ? (
          <View style={{ gap: 8 }}>
            <Text style={styles.body}>Não foi possível carregar o plano e o preço agora. Verifique sua conexão e tente novamente.</Text>
            <Pressable onPress={() => void load()} accessibilityRole="button" style={styles.linkButton}><Text style={styles.link}>Tentar novamente</Text></Pressable>
          </View>
        ) : null}
        {plans?.map((plan) => {
          const isSelected = plan.id === selectedId;
          return (
            <Pressable
              key={plan.id}
              onPress={() => setSelectedId(plan.id)}
              accessibilityRole={plans.length > 1 ? 'radio' : 'text'}
              accessibilityState={{ selected: isSelected }}
              style={[styles.planCard, isSelected && styles.planCardSelected]}
            >
              <Text style={styles.planName}>{plan.name}</Text>
              <Text style={styles.planPrice}>{plan.priceString}{plan.periodLabel ? ` ${plan.periodLabel}` : ''}</Text>
              {plan.periodLabel ? null : <Text style={styles.body}>O período de cobrança é informado pela loja na confirmação da compra.</Text>}
              {plan.introLabel ? <Text style={styles.planIntro}>{plan.introLabel}</Text> : null}
            </Pressable>
          );
        })}

        <Text style={styles.body}>{t.renewal}</Text>

        <Pressable
          onPress={onSubscribe}
          disabled={!selected || busy}
          accessibilityRole="button"
          accessibilityLabel={selected ? t.subscribe(selected.name) : 'Assinar'}
          style={[styles.primary, (!selected || busy) && styles.primaryDisabled]}
        >
          <Text style={styles.primaryText}>{busy ? 'Abrindo pagamento...' : selected ? t.subscribe(selected.name) : 'Assinar'}</Text>
        </Pressable>
        <Text style={styles.small}>{t.billing}</Text>
        {message ? <Text style={styles.status}>{message}</Text> : null}
      </View>

      <View style={styles.linksRow}>
        <Pressable onPress={onOpenTerms} accessibilityRole="link" style={styles.linkButton}><Text style={styles.link}>{t.terms}</Text></Pressable>
        <Pressable onPress={onOpenPrivacy} accessibilityRole="link" style={styles.linkButton}><Text style={styles.link}>{t.privacy}</Text></Pressable>
        <Pressable
          disabled={restoring}
          accessibilityRole="button"
          style={styles.linkButton}
          onPress={async () => {
            setRestoring(true);
            const result = await restore();
            setRestoreMessage(result.message);
            setRestoring(false);
            if (result.status === 'restored') { onRestored(); setTimeout(onRestored, 4000); }
          }}
        >
          <Text style={styles.link}>{restoring ? 'Restaurando...' : t.restore}</Text>
        </Pressable>
      </View>
      {restoreMessage ? <Text style={styles.small}>{restoreMessage}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  // Largura maxima centralizada: no iPad (inclusive Air de 11 polegadas) o conteudo nao estica por toda a tela; no iPhone ocupa a largura disponivel.
  wrap: { width: '100%', maxWidth: 560, alignSelf: 'center', gap: 16 },
  title: { color: '#111827', fontSize: 28, lineHeight: 34, fontWeight: '800' },
  subtitle: { color: '#334155', fontSize: 16, lineHeight: 23 },
  card: { borderRadius: 12, borderWidth: 1, borderColor: '#dbe4ea', backgroundColor: '#ffffff', padding: 16, gap: 14 },
  heading: { color: '#111827', fontSize: 18, lineHeight: 24, fontWeight: '800' },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  benefitIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: '#e8f3f8', alignItems: 'center', justifyContent: 'center' },
  benefitText: { flex: 1, gap: 2 },
  benefitTitle: { color: '#111827', fontSize: 16, lineHeight: 22, fontWeight: '700' },
  benefitDescription: { color: '#334155', fontSize: 15, lineHeight: 21 },
  planCard: { borderRadius: 10, borderWidth: 1, borderColor: '#dbe4ea', padding: 14, gap: 4 },
  planCardSelected: { borderColor: PRColors.ocean, borderWidth: 2, backgroundColor: '#f2f9fc' },
  planName: { color: '#111827', fontSize: 17, lineHeight: 23, fontWeight: '800' },
  planPrice: { color: '#111827', fontSize: 20, lineHeight: 26, fontWeight: '800' },
  planIntro: { color: PRColors.success, fontSize: 15, lineHeight: 21, fontWeight: '700' },
  body: { color: '#1f2937', fontSize: 15, lineHeight: 22 },
  small: { color: '#475569', fontSize: 14, lineHeight: 20 },
  status: { color: '#1f2937', fontSize: 14, lineHeight: 20, fontWeight: '600' },
  primary: { minHeight: 52, borderRadius: 10, backgroundColor: PRColors.ocean, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16, paddingVertical: 10 },
  primaryDisabled: { opacity: 0.5 },
  primaryText: { color: '#ffffff', fontSize: 17, lineHeight: 22, fontWeight: '800', textAlign: 'center' },
  linksRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', columnGap: 20, rowGap: 4 },
  linkButton: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 4 },
  link: { color: PRColors.ocean, fontSize: 15, lineHeight: 20, fontWeight: '700', textDecorationLine: 'underline' },
});
