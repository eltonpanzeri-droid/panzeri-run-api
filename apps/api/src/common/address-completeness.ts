// Endereco completo (13/11/2026, pedido de Elton: "garanta que o endereco completo sera preenchido; essa informacao e importante").
// Funcao PURA, so' leitura: diz o que falta no endereco guardado nas respostas da entrevista. NUNCA bloqueia conclusao da entrevista nem pagamento (o aplicativo antigo, ja publicado, permite
// pular rua/bairro no modo manual, e travar o ultimo passo ja' foi um bug grave — caso Silvia, 04/09). A garantia vem da tela nova (exige os campos) e do aviso no painel.
export const ADDRESS_FIELD_LABELS: Record<string, string> = {
  personal_address_street: 'rua',
  personal_address_number: 'número',
  personal_address_neighborhood: 'bairro',
  personal_address_city: 'cidade',
  personal_address_state: 'estado',
};

const filled = (value: unknown): boolean => value !== undefined && value !== null && String(value).trim() !== '';

export function addressCompleteness(answers: Record<string, unknown> | null | undefined): { complete: boolean; missing: string[] } {
  const a = answers ?? {};
  const missing: string[] = [];
  // O CEP e' o endereco quando existe; no modo manual (CEP nao encontrado) a cidade e o estado o substituem, mas rua, numero e bairro seguem necessarios.
  const hasCepOrManual = filled(a.personal_cep) || (filled(a.personal_address_city) && filled(a.personal_address_state));
  if (!hasCepOrManual) missing.push('CEP');
  for (const key of Object.keys(ADDRESS_FIELD_LABELS)) if (!filled(a[key])) missing.push(ADDRESS_FIELD_LABELS[key]);
  return { complete: missing.length === 0, missing };
}
