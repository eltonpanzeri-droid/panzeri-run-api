// Porta de habilitacao da Wahoo durante a validacao real (08/10/2026).
// WAHOO_ENABLED_USER_IDS: ids de usuario (UUID do JWT) separados por virgula, ou "*" para liberar a todos.
// Ausente/vazio = ninguem (fail-closed): configurar as credenciais NAO libera a integracao. Sem banco, sem segredo no app.
export function isWahooEnabledFor(raw: string | undefined | null, userId: string): boolean {
  const value = raw?.trim();
  if (!value || !userId) return false;
  if (value === '*') return true;
  return value.split(',').map((item) => item.trim()).filter(Boolean).includes(userId);
}
