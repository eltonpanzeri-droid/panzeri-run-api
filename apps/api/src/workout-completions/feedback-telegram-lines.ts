// Linhas do aviso de feedback enviado ao treinador no Telegram (10/11/2026, pedido de Elton): numero do treino, data prescrita, data realizada e dor. Funcoes puras, sem banco.

const SP = 'America/Sao_Paulo';

// scheduledDate e' meia-noite UTC (data-calendario); completedAt e' um instante real: so' a data, no fuso de Sao Paulo.
export const prescribedDateLabel = (scheduledDate: Date): string => scheduledDate.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
export const doneDateLabel = (completedAt: Date | null | undefined): string => (completedAt ? completedAt.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: SP }) : 'não informada');

// "Treino 3 de 7 do programa (Cód. 12)": posicao do treino no programa, em ordem de data. Sem a posicao (nao achou), so' o codigo do programa.
export function trainingNumberLabel(position: number | null, total: number, planCode: number | null | undefined): string {
  const code = planCode != null ? `programa Cód. ${planCode}` : 'programa';
  return position != null && position >= 0 ? `Treino ${position + 1} de ${total} do ${code}` : `Treino do ${code}`;
}

const PAIN_LABEL: Record<string, string> = { none: 'Nenhuma', leve: 'Leve', moderado: 'Moderado', forte: 'Forte' };

// Dor do treino. Marcou "sem dor" (none) => "sem dor", nunca omitido; nao respondeu => diz que nao respondeu (nunca presume). Com dor, junta o relato detalhado de HOJE (0 a 10), se houver.
export function painLine(input: { painFlag?: string | null; timingLabel?: string | null; todayReport?: { intensity: number; regions: string[] } | null }): string {
  if (!input.painFlag) return '🩹 Dor durante o treino: não respondida';
  if (input.painFlag === 'none') return '🩹 Dor durante o treino: sem dor';
  const base = `🩹 Dor durante o treino: ${PAIN_LABEL[input.painFlag] ?? input.painFlag}${input.timingLabel ? ` — ${input.timingLabel}` : ''}`;
  const report = input.todayReport;
  return report ? `${base} | relato de dor de hoje: ${report.intensity}/10${report.regions.length ? ` (${report.regions.join(', ')})` : ''}` : base;
}
