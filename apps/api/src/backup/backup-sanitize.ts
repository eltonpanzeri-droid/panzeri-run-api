// Protecao de credenciais no backup (05/10/2026). Duas pecas:
//  1) pgEnvFromUrl: a DATABASE_URL e' decomposta em variaveis de ambiente do libpq (PGHOST, PGUSER, ...)
//     para o processo filho — nada de URL em argumentos de comando nem em shell interpolado. Com isso a
//     mensagem de erro do child_process (que ecoa comando + argumentos) nunca contem a URL.
//  2) redactSecrets: sanitizacao defensiva de QUALQUER texto de erro antes de log/Telegram/HTTP —
//     remove os segredos conhecidos e qualquer coisa com cara de URL (esquema://...).

export function pgEnvFromUrl(databaseUrl: string): Record<string, string> {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    // Nunca ecoar o valor recebido.
    throw new Error('DATABASE_URL invalida (formato esperado: postgresql://usuario:senha@host:porta/banco).');
  }
  if (!/^postgres(ql)?:$/.test(url.protocol)) throw new Error('DATABASE_URL invalida (esquema nao e postgresql).');
  const env: Record<string, string> = {
    PGHOST: decodeURIComponent(url.hostname),
    PGPORT: url.port || '5432',
    PGUSER: decodeURIComponent(url.username),
    PGPASSWORD: decodeURIComponent(url.password),
    PGDATABASE: decodeURIComponent(url.pathname.replace(/^\//, '')),
  };
  const sslmode = url.searchParams.get('sslmode');
  if (sslmode) env.PGSSLMODE = sslmode;
  return env;
}

// Segredos que podem aparecer em mensagens de erro, derivados dos valores reais de configuracao.
export function secretsFromDatabaseUrl(databaseUrl: string | undefined): string[] {
  if (!databaseUrl) return [];
  const secrets = [databaseUrl];
  try {
    const url = new URL(databaseUrl);
    secrets.push(url.password, decodeURIComponent(url.password), url.username, decodeURIComponent(url.username));
  } catch { /* URL invalida: so' o valor bruto */ }
  return secrets;
}

export function redactSecrets(text: unknown, secrets: Array<string | undefined | null>): string {
  let out = typeof text === 'string' ? text : text instanceof Error ? text.message : String(text);
  for (const secret of secrets) {
    if (secret && secret.length >= 4) out = out.split(secret).join('[redigido]');
  }
  // Defesa em profundidade: qualquer URL com esquema (postgresql://, https://...) e' removida.
  out = out.replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s"'<>]*/gi, '[url-redigida]');
  return out.slice(0, 500);
}
