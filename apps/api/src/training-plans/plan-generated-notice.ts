// Avisos ao aluno quando um programa de treino da semana fica pronto (18/11/2026, pedido de Elton): o aviso no celular e o E-MAIL saem em toda geracao, qualquer que seja a marca do relogio.
// Quem ja enviou treinos ao Apple Watch recebe, alem disso, o pedido de conferir se chegaram ao relogio (a Apple so deixa o iPhone agendar o treino; se a aluna saiu do Panzeri Run antes do fim
// da geracao, o envio pode nao ter acontecido) e, se nao chegaram, tocar em "Sincronizar envio de treinos ao relógio". Funcoes puras, testaveis sem banco.

import { weeklyEmailHtml, weeklyEmailText, type WeeklyEmailData } from './weekly-email';

const APPLE_WATCH_CHECK = 'Confira se os treinos da semana chegaram ao seu Apple Watch. Se não chegaram, abra o Panzeri Run no iPhone e toque em "Sincronizar envio de treinos ao relógio".';

export function planGeneratedPush(baseMessage: string, usesAppleWatch: boolean): { title: string; message: string } {
  return { title: '🏃 Seu novo programa chegou!', message: usesAppleWatch ? `${baseMessage} ${APPLE_WATCH_CHECK}` : baseMessage };
}

// Com `weekly` (22/11/2026): e-mail rico (cartoes e barras em HTML + versao em texto). Sem `weekly` (dados indisponiveis), o texto simples de antes.
export function planGeneratedEmail(input: { name: string; baseMessage: string; usesAppleWatch: boolean; weekly?: WeeklyEmailData | null }): { subject: string; content: string; html?: string } {
  const first = (input.name ?? '').trim().split(/\s+/)[0] || 'tudo bem';
  if (input.weekly) {
    const args = { firstName: first, data: input.weekly, baseMessage: input.baseMessage, appleWatchNote: input.usesAppleWatch ? APPLE_WATCH_CHECK : null };
    return { subject: 'Seu novo programa de treino chegou', content: weeklyEmailText(args), html: weeklyEmailHtml(args) };
  }
  const parts = [
    `Olá ${first},`,
    'Seu novo programa de treino da semana está pronto no Panzeri Run. Abra o Panzeri Run para ver os treinos.',
    input.baseMessage,
  ];
  if (input.usesAppleWatch) parts.push(APPLE_WATCH_CHECK);
  parts.push('Panzeri Run');
  return { subject: 'Seu novo programa de treino chegou', content: parts.join('\n\n') };
}
