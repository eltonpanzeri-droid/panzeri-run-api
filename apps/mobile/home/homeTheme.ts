// Tokens visuais da nova Home do aluno (30/09/2026, ordem fechada de Elton). Paleta PRÓPRIA desta
// intervenção — distinta de theme/tokens.ts (PRColors, identidade de marca já usada em
// splash/onboarding/login/header). Só tema claro por enquanto (pedido explícito: não redesenhar
// agora todo o sistema de temas); a forma como os tokens estão organizados aqui (objeto único,
// nunca cor hardcodada inline nos componentes) já deixa o caminho aberto pra um HomeThemeDark
// futuro sem precisar reescrever os componentes.

export const HomeColors = {
  background: '#F5F7FA',
  surface: '#FFFFFF',
  surfaceSecondary: '#F8FAFC',
  surfaceHighlight: '#F1F6FC',
  panzeriPrimary: '#123B67',
  panzeriInteraction: '#1769AA',
  panzeriAccent: '#2186D4',
  panzeriLight: '#DCECF8',
  textPrimary: '#152033',
  textSecondary: '#5F6B7A',
  textTertiary: '#8B96A5',
  divider: '#E5EAF0',
  success: '#2F8F67',
  warning: '#C58A2A',
  alert: '#C95C5C',
  plotArea: '#F6F9FC',
} as const;

export const HomeGradients = {
  hero: ['#123B67', '#1769AA', '#2186D4'] as const, // 0% / 55% / 100%, ver angle no componente (135deg)
  acompanhamento: ['#F1F6FC', '#FFFFFF'] as const,
  glow: 'rgba(77, 169, 230, 0.18)',
} as const;

export const HomeRadius = {
  cardLarge: 20,
  cardMedium: 18,
  small: 12,
  pill: 999,
  plotArea: 15,
} as const;

export const HomeSpace = {
  micro: 4,
  small: 8,
  related: 12,
  component: 16,
  block: 24,
  section: 32,
} as const;

export const HomeShadow = {
  card: {
    shadowColor: 'rgba(20, 45, 75, 1)',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.06,
    shadowRadius: 30,
    elevation: 3,
  },
} as const;

export const HomeBorder = {
  card: { borderWidth: 1, borderColor: 'rgba(20, 50, 80, 0.07)' },
  divider: { borderTopWidth: 1, borderTopColor: HomeColors.divider },
} as const;

/** Grau das medalhas — cores base (SISTEMA_DE_MEDALHAS.md secao 15 / ordem fechada da Home secao 13.3). */
export const MedalGrauColors: Record<string, string> = {
  bronze: '#B97850',
  prata: '#9AA6B2',
  ouro: '#D2A33A',
  platina: '#5F8FA3',
  diamante: '#537FC4',
  lendaria: '#123B67', // azul profundo + detalhe dourado aplicado no componente, nao so cor solida
};

export const HomeTypography = {
  greeting: { fontSize: 28, fontWeight: '700' as const },
  sectionTitle: { fontSize: 21, fontWeight: '700' as const },
  numberPrimary: { fontSize: 30, fontWeight: '700' as const },
  numberSecondary: { fontSize: 22, fontWeight: '700' as const },
  body: { fontSize: 15, fontWeight: '400' as const },
  bodyMedium: { fontSize: 15, fontWeight: '500' as const },
  label: { fontSize: 12, fontWeight: '600' as const },
  tertiary: { fontSize: 11, fontWeight: '500' as const },
} as const;

/** Formata numero pra exibicao: no maximo 1 casa decimal, virgula (pt-BR), nunca 8 casas. */
export function formatMetric(value: number | null | undefined, decimals: 0 | 1 = 1): string {
  if (value == null || Number.isNaN(value)) return '—';
  const rounded = Math.round(value * (decimals === 1 ? 10 : 1)) / (decimals === 1 ? 10 : 1);
  return rounded.toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}
