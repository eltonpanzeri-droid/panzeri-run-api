// Local e horario da prova alvo no formulario da aluna (09/11/2026, ordem do Elton): cidade, UF (opcional) e horario da largada, para o futuro indice de temperatura de bulbo umido (WBGT).
// Funcoes puras do formulario. O servidor valida de novo (HH:MM, UF de 2 letras).

// Digitos viram "HH:MM" enquanto a aluna digita ("0600" -> "06:00").
export function formatTimeInputText(text: string): string {
  const digits = text.replace(/\D/g, '').slice(0, 4);
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

// 'HH:MM' valido (00:00 a 23:59) ou null. Aceita "6:00" e "06:00".
export function normalizeStartTime(input: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(input.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, '0')}:${match[2]}`;
}

// Ao CADASTRAR uma prova nova, cidade e horario sao obrigatorios; ao EDITAR uma prova antiga (sem esses dados) ficam opcionais, mas se o horario for digitado tem que ser valido.
export function validateRaceLocation(input: { city: string; state: string; time: string }, options: { required: boolean }): string | null {
  const city = input.city.trim();
  const time = input.time.trim();
  if (options.required && !city) return 'Digite a cidade da prova.';
  if (options.required && !time) return 'Digite o horário da largada (hh:mm).';
  if (time && normalizeStartTime(time) === null) return 'Digite o horário da largada no formato hh:mm (de 00:00 a 23:59).';
  const state = input.state.trim();
  if (state && !/^[A-Za-z]{2}$/.test(state)) return 'A UF deve ter 2 letras (exemplo: MG).';
  return null;
}

// "Contagem/MG · largada 06:00" para o cartao da prova; null quando nada foi informado.
export function formatRaceWhere(race: { city?: string | null; state?: string | null; startTime?: string | null }): string | null {
  const city = race.city?.trim();
  const state = race.state?.trim();
  const place = city ? (state ? `${city}/${state}` : city) : null;
  const time = race.startTime?.trim() ? `largada ${race.startTime.trim()}` : null;
  const parts = [place, time].filter((part): part is string => Boolean(part));
  return parts.length > 0 ? parts.join(' · ') : null;
}
