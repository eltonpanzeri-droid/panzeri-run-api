// Porta de habilitacao generica dos provedores da Central durante a validacao real (mesma regra da Wahoo).
// Valor: ids de usuario (UUID do JWT) separados por virgula, ou "*" para liberar a todos. Ausente/vazio = ninguem (fail-closed): configurar as
// credenciais do provedor NAO libera a integracao. Sem banco, sem segredo no app.
export function isEnabledFor(raw: string | undefined | null, userId: string): boolean {
  const value = raw?.trim();
  if (!value || !userId) return false;
  if (value === '*') return true;
  return value.split(',').map((item) => item.trim()).filter(Boolean).includes(userId);
}
