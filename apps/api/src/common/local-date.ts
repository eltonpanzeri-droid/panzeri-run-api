// REGRA UNICA do dia LOCAL de uma atividade (lote 4, 26/10/2026). Todos os consumidores (vinculo de atividade com treino, Evolucao, relatorio e totais semanais, calendario, carga,
// tenis) usam ESTA funcao, para nunca discordarem sobre em que dia (e em que semana) cai a mesma atividade.
//   - o deslocamento informado pelo aparelho/provedor (utcOffsetMinutes) e' SEMPRE preservado e prevalece: dia local = instante UTC + deslocamento;
//   - sem deslocamento informado: ate' o CORTE (variavel LOCAL_DATE_CUTOVER_AT, instante ISO definido no deploy) vale a regra ANTIGA (dia UTC), para historico, vinculos e medalhas
//     nao mudarem; a partir do corte vale America/Sao_Paulo. Sem a variavel (ou invalida), a regra antiga continua para tudo — nada muda sem configuracao explicita.
// Nada e' gravado: so' a INTERPRETACAO do instante muda. Registros historicos e vinculos ja' existentes nao sao alterados nem refeitos.

export const OPERATIONAL_TIME_ZONE = 'America/Sao_Paulo';

const operationalDayFormatter = new Intl.DateTimeFormat('en-US', { timeZone: OPERATIONAL_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' });

export const LOCAL_DATE_CUTOVER_ENV = 'LOCAL_DATE_CUTOVER_AT';

// Instante do corte, lido a cada chamada (configuracao de deploy; testavel). Ausente/invalido => null => regra antiga para tudo.
function cutoverTime(): number | null {
  const raw = process.env[LOCAL_DATE_CUTOVER_ENV]?.trim();
  if (!raw) return null;
  const t = Date.parse(raw);
  return Number.isFinite(t) ? t : null;
}

export function hasInformedOffset(utcOffsetMinutes: number | null | undefined): utcOffsetMinutes is number {
  return typeof utcOffsetMinutes === 'number' && Number.isFinite(utcOffsetMinutes);
}

// 'YYYY-MM-DD' do dia local do instante.
export function activityLocalDate(startedAt: Date, utcOffsetMinutes?: number | null): string {
  if (hasInformedOffset(utcOffsetMinutes)) return new Date(startedAt.getTime() + utcOffsetMinutes * 60_000).toISOString().slice(0, 10);
  const cutover = cutoverTime();
  if (cutover === null || startedAt.getTime() < cutover) return startedAt.toISOString().slice(0, 10); // regra antiga (UTC): sem offset e antes do corte
  // formatToParts: independe do formato do locale (nunca interpreta uma string 'bonita').
  const parts = operationalDayFormatter.formatToParts(startedAt);
  const part = (type: string) => parts.find((p) => p.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

// Mesmo dia local, como Date a meia-noite UTC (formato em que TrainingSession.scheduledDate e' guardada).
export function activityLocalDayStart(startedAt: Date, utcOffsetMinutes?: number | null): Date {
  return new Date(`${activityLocalDate(startedAt, utcOffsetMinutes)}T00:00:00.000Z`);
}
