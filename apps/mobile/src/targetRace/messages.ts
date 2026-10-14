// Mensagens da tela "Prova alvo" (sem React Native: testavel). O servidor devolve a recusa como LISTA de textos tecnicos (em ingles); aqui viram frases
// claras. Antes disso o app so' mostrava "Nao consegui salvar essa meta." e a aluna nao sabia o que corrigir.
export const MAX_TARGET_SECONDS = 172800; // 48 h, mesmo limite do servidor

// Valida o tempo-alvo digitado em horas/min/seg ANTES de enviar. Campos vazios valem 0. Devolve a mensagem ou null.
export function validateTargetTime(hours: string, minutes: string, seconds: string): string | null {
  const parts = [hours, minutes, seconds].map((value) => (value.trim() === '' ? 0 : Number(value)));
  if (parts.some((value) => !Number.isFinite(value) || !Number.isInteger(value) || value < 0)) return 'Use apenas numeros inteiros no tempo-alvo (horas, minutos e segundos).';
  const [h, m, s] = parts;
  if (m > 59 || s > 59) return 'Minutos e segundos devem ficar entre 0 e 59. Se a meta passa de 60 minutos, use o campo de horas.';
  if (h * 3600 + m * 60 + s > MAX_TARGET_SECONDS) return 'O tempo-alvo deve ter no maximo 48 horas. Confira se voce nao digitou os minutos no campo de horas.';
  return null;
}

const KNOWN: Array<[RegExp, string]> = [
  [/targetSeconds must not be greater/i, 'O tempo-alvo deve ter no maximo 48 horas. Confira se voce nao digitou os minutos no campo de horas.'],
  [/targetSeconds must be an integer|targetSeconds must not be less/i, 'Confira o tempo-alvo: use apenas numeros inteiros.'],
  [/distanceKm must not be greater/i, 'A distancia deve ser de no maximo 999 km.'],
  [/distanceKm must not be less|distanceKm must be a number/i, 'Digite uma distancia valida em quilometros.'],
  [/raceDate/i, 'Confira a data da prova (dia/mes/ano).'],
  [/name /i, 'Digite o nome da prova.'],
  [/Level|Intent|Importance|Difficulty|Willingness|Satisfaction|Concern|Openness/i, 'Confira as respostas de 1 a 10 do questionario.'],
];

// Traduz a resposta de erro do servidor. status 0 = sem resposta (rede).
export function describeTargetRaceError(status: number, body: unknown): string {
  const message = (body as { message?: unknown } | null)?.message;
  const list = Array.isArray(message) ? message.filter((item): item is string => typeof item === 'string') : typeof message === 'string' ? [message] : [];
  if (status === 400 && list.length) {
    const friendly = [...new Set(list.map((item) => KNOWN.find(([pattern]) => pattern.test(item))?.[1]).filter((item): item is string => !!item))];
    return friendly.length ? friendly.join(' ') : 'Alguns dados da meta nao foram aceitos. Confira os campos e tente de novo.';
  }
  if (status === 401) return 'Sua sessao expirou. Saia e entre de novo no aplicativo para salvar a meta.';
  if (status === 0) return 'Sem conexao com o servidor. Verifique a internet e tente de novo.';
  if (typeof message === 'string' && message.trim() && status < 500) return message;
  return `Nao consegui salvar a meta agora (erro ${status || 'de rede'}). Tente de novo em instantes; se continuar, avise o treinador.`;
}
