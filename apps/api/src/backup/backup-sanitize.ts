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

// Trava do restore: dois URLs apontam para o MESMO banco se coincidem hostname, porta efetiva (padrao 5432) e nome do
// database. Usuario, senha, query (sslmode, ordem dos parametros...) NAO contam. Loopback (localhost, 127.0.0.1, ::1)
// e' tratado como um so' host. Fail-closed: URL ilegivel ou com parametros que redefinem host/porta/banco na query
// (host, hostaddr, port, dbname) nao pode ser comparado com seguranca e conta como "mesmo banco".
const OVERRIDING_QUERY_PARAMS = ['host', 'hostaddr', 'port', 'dbname'];
const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1']);

function databaseIdentity(raw: string): string | null {
  try {
    const url = new URL(raw);
    if (!/^postgres(ql)?:$/.test(url.protocol)) return null;
    if (OVERRIDING_QUERY_PARAMS.some((name) => url.searchParams.has(name))) return null;
    let host = decodeURIComponent(url.hostname).toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
    if (LOOPBACK.has(host)) host = 'loopback';
    const port = url.port || '5432';
    const database = decodeURIComponent(url.pathname.replace(/^\//, ''));
    return host && database ? `${host}:${port}/${database}` : null;
  } catch {
    return null;
  }
}

export function sameDatabaseTarget(a: string, b: string): boolean {
  const left = databaseIdentity(a);
  const right = databaseIdentity(b);
  if (left === null || right === null) return true; // nao comparavel => bloqueia
  return left === right;
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
