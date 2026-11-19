import type { NotificationCategoryId } from './notification-policy';

// Biblioteca de avisos educativos e de uso (19/11/2026, ordem de Elton, Lotes 3 e 4). Textos FIXOS escritos para todas as alunas: nenhum e' gerado por IA nem calculado por formula. Sao orientacoes gerais e de uso do
// Panzeri Run; nao substituem avaliacao medica nem a prescricao do programa. Revisar o tom antes de ligar o envio (PROACTIVE_NOTIFICATIONS_ENABLED).
// Regras de linguagem: dizer "Panzeri Run" (nunca "app"), "programa de treino" (nunca "plano de treino"), nada de "motor".
export interface LibraryTip { id: string; category: NotificationCategoryId; title: string; message: string }

export const NOTIFICATION_LIBRARY: readonly LibraryTip[] = [
  // Instrucoes de uso do Panzeri Run
  { id: 'instrucoes-feedback', category: 'instrucoes', title: 'Conte como foi o treino', message: 'Depois de cada treino, registre como foi no feedback do treino. É com ele que a IA ajusta os seus próximos programas.' },
  { id: 'instrucoes-relogio', category: 'instrucoes', title: 'Conecte o seu relógio', message: 'Em Dispositivos e integrações você conecta o relógio, e os seus treinos chegam ao Panzeri Run sozinhos.' },
  { id: 'instrucoes-relatar', category: 'instrucoes', title: 'Algo não ficou certo?', message: 'Se encontrar algo estranho no Panzeri Run, use Relatar problema no menu e conte o que aconteceu. Isso nos ajuda a melhorar.' },
  { id: 'instrucoes-notificacoes', category: 'instrucoes', title: 'Escolha o que você quer receber', message: 'Em Preferências de notificações você escolhe os temas, quantos avisos por dia e o horário em que quer recebê-los.' },
  { id: 'instrucoes-ritmo', category: 'instrucoes', title: 'Ritmo ou velocidade', message: 'No treino, você pode escolher ver o ritmo (minutos por quilômetro) ou a velocidade (quilômetros por hora).' },
  // Novidades do Panzeri Run
  { id: 'novidades-faixa-ritmo', category: 'novidades', title: 'Treinos com faixa de ritmo', message: 'Os seus treinos agora trazem uma faixa de ritmo, e o relógio avisa quando você sair dela.' },
  { id: 'novidades-prova', category: 'novidades', title: 'Provas com bandeirinha', message: 'As provas que você marca no calendário aparecem no programa com uma bandeirinha 🏁.' },
  { id: 'novidades-dados', category: 'novidades', title: 'Seus dados são seus', message: 'Em Privacidade e dados você pode baixar um arquivo com os seus dados do Panzeri Run.' },
  // Relatorios
  { id: 'relatorios-resumo', category: 'relatorios', title: 'Seu resumo na tela inicial', message: 'Na tela inicial, Seu resumo mostra os seus números por período. Você escolhe o período que quer ver.' },
  { id: 'relatorios-evolucao', category: 'relatorios', title: 'Veja a sua evolução', message: 'Em Evolução, cada área (treinamento, carga, sono, bem-estar, dor e aderência) mostra o que mudou e como interpretar.' },
  // Dicas de saude (orientacao geral, sem diagnostico)
  { id: 'saude-sono', category: 'saude', title: 'Sono também é treino', message: 'É dormindo que o corpo absorve o treino. Manter horários regulares de sono ajuda na recuperação.' },
  { id: 'saude-hidratacao', category: 'saude', title: 'Hidratação ao longo do dia', message: 'Beba água ao longo do dia, não só perto do treino. Em dias quentes, preste ainda mais atenção.' },
  { id: 'saude-dor', category: 'saude', title: 'Dor que não passa', message: 'Desconforto leve que some é comum. Dor que continua ou piora merece atenção: registre no feedback e, se persistir, procure um profissional de saúde.' },
  { id: 'saude-aquecimento', category: 'saude', title: 'Comece devagar', message: 'Antes do treino, alguns minutos de caminhada ou trote leve preparam o corpo e ajudam a evitar sustos.' },
  // Educacao para o treino
  { id: 'educacao-leve', category: 'educacao_treino', title: 'Dia leve tem função', message: 'Os treinos leves servem para você absorver o treino e render nos dias mais fortes. Respeitar o ritmo leve faz parte do programa.' },
  { id: 'educacao-descanso', category: 'educacao_treino', title: 'Descanso faz parte', message: 'A evolução acontece na recuperação. O dia de descanso do programa é tão importante quanto o treino.' },
  { id: 'educacao-longao', category: 'educacao_treino', title: 'O longão', message: 'No treino longo, o objetivo é aguentar o tempo de esforço em ritmo confortável, não correr rápido.' },
  { id: 'educacao-faixa', category: 'educacao_treino', title: 'Seguir a faixa de ritmo', message: 'A faixa de ritmo do treino mostra a intensidade desejada. Ficar dentro dela é mais importante do que correr mais rápido.' },
  // Dicas gerais sobre o mundo das corridas e treinos
  { id: 'mundo-prova-largada', category: 'mundo_corrida', title: 'Largada de prova', message: 'Em prova, é comum sair empolgado. Começar um pouco mais devagar costuma deixar você mais forte no final.' },
  { id: 'mundo-tenis', category: 'mundo_corrida', title: 'Cuide do tênis', message: 'Tênis de corrida tem vida útil. Acompanhe a quilometragem dele e fique atenta a sinais de desgaste.' },
  { id: 'mundo-vespera', category: 'mundo_corrida', title: 'Véspera de prova', message: 'Na véspera, evite novidades: use o tênis, a roupa e a alimentação que você já testou nos treinos.' },
  { id: 'mundo-constancia', category: 'mundo_corrida', title: 'Constância vence', message: 'Quem corre com regularidade evolui mais do que quem treina forte por pouco tempo e para.' },
];

export const LIBRARY_REPEAT_DAYS = 90; // depois de 90 dias o mesmo aviso pode voltar

export const libraryRuleId = (tip: LibraryTip) => `tip:${tip.id}`;

// Proximo aviso da categoria que a aluna ainda nao recebeu (dentro da janela de repeticao). null = ja recebeu todos.
export function nextTipFor(category: string, recentlySentRuleIds: ReadonlySet<string>): LibraryTip | null {
  return NOTIFICATION_LIBRARY.find((tip) => tip.category === category && !recentlySentRuleIds.has(libraryRuleId(tip))) ?? null;
}

// Duas categorias por dia, em rodizio: cada tema aparece mais ou menos a cada tres dias (e nunca passa do teto que a aluna escolheu; ver o orquestrador).
export const TIPS_PER_DAY = 2;
export function categoriesForDay(categories: readonly string[], dayIndex: number, perDay: number = TIPS_PER_DAY): string[] {
  if (categories.length === 0) return [];
  return Array.from({ length: Math.min(perDay, categories.length) }, (_, i) => categories[(dayIndex * perDay + i) % categories.length]);
}
