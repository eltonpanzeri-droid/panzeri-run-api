// Janela de semana do aluno (20/09/2026) — regras de data do app SEMPRE no fuso de Sao Paulo.
//
// Bug real corrigido aqui: planStartsInFuture() comparava a data do plano (dia de Sao Paulo guardado como
// meia-noite UTC) com "amanha" calculado em data LOCAL do aparelho e convertido com toISOString() (UTC).
// Nas ultimas 3 horas do domingo (21:00-23:59 BRT) o UTC ja virou segunda, "amanha" pulava um dia e o plano
// recem-gerado para a semana seguinte era considerado "nao futuro" — o app escondia o plano e mostrava
// "Sua semana esta liberada" com o botao de gerar, embora o treino existisse (e aparecesse no admin).

const SAO_PAULO = 'America/Sao_Paulo';

// 'YYYY-MM-DD' do dia corrente em Sao Paulo, independente do fuso do aparelho.
export function saoPauloDateString(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: SAO_PAULO, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

// 'YYYY-MM-DD' de amanha em Sao Paulo.
export function saoPauloTomorrowString(now: Date): string {
  const [year, month, day] = saoPauloDateString(now).split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day + 1)).toISOString().slice(0, 10);
}

// Um plano cuja data de inicio (dia de Sao Paulo) e de amanha em diante e' sempre o NOVO plano, gerado pelo
// toque no botao — distingue-o do plano antigo, que ainda cobre o proprio domingo.
export function planStartsInFuture(plan: { startDate?: string } | null, now: Date = new Date()): boolean {
  if (!plan?.startDate) return false;
  return plan.startDate.slice(0, 10) >= saoPauloTomorrowString(now);
}
