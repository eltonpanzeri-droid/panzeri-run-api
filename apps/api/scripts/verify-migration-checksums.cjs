#!/usr/bin/env node
/* eslint-disable */
// Verificacao OFFLINE e SOMENTE LEITURA do historico de migrations de producao (correcao pos-revisao do Astra, 10/10/2026).
//
// O que faz: compara o resultado da consulta de leitura `verify-migrations-production.sql` (um JSON salvo em arquivo) com o repositorio:
//   - checksum COMPLETO (sha256 do arquivo migration.sql) de cada migration no banco x checksum da versao ATUAL do arquivo;
//   - se diferir, procura o mesmo checksum em TODAS as versoes historicas do arquivo (git) e diz qual versao foi aplicada;
//   - migrations no banco que nao existem no repositorio, migrations do repositorio ainda nao aplicadas, falhas e reversoes.
// NAO se conecta a nenhum banco, NAO altera nenhum arquivo e nenhuma migration. Usa apenas o git local (leitura).
//
// Uso:  node scripts/verify-migration-checksums.cjs <arquivo-json-da-consulta> [--json]
// Saida: tabela legivel e codigo de saida 0 (tudo igual ao arquivo atual), 1 (ha divergencia ou problema), 2 (uso/entrada invalida).
const { execFileSync } = require('child_process');
const { createHash } = require('crypto');
const { existsSync, readdirSync, readFileSync } = require('fs');
const { join, relative, resolve } = require('path');

const sha256 = (buffer) => createHash('sha256').update(buffer).digest('hex');
// O checksum do Prisma e' o sha256 dos BYTES do arquivo. O mesmo SQL aplicado a partir de um checkout com fim de linha CRLF (Windows) gera outro
// checksum que o de um checkout LF (Linux/Docker). As duas formas do MESMO conteudo sao aceitas como iguais (e sinalizadas).
const lineEndingVariants = (buffer) => {
  const lf = Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n'), 'utf8');
  const crlf = Buffer.from(buffer.toString('utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'), 'utf8');
  return { lf: sha256(lf), crlf: sha256(crlf) };
};

function git(args, cwd, options = {}) {
  return execFileSync('git', args, { cwd, maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'ignore'], ...options });
}

// Todas as versoes que o arquivo migration.sql ja teve no historico do git (mais recente primeiro). Cada uma com o checksum que o Prisma teria gravado.
function historicalVersions(repoRoot, relPath) {
  let log = '';
  try { log = git(['log', '--format=%H|%ad|%s', '--date=short', '--', relPath], repoRoot).toString('utf8'); } catch { return []; }
  const versions = [];
  for (const line of log.split('\n').filter(Boolean)) {
    const [commit, date, ...subject] = line.split('|');
    try {
      const content = git(['show', `${commit}:${relPath}`], repoRoot);
      const variants = lineEndingVariants(content);
      versions.push({ commit: commit.slice(0, 8), date, subject: subject.join('|'), checksum: sha256(content), variants: [variants.lf, variants.crlf] });
    } catch { /* commit que removeu o arquivo */ }
  }
  return versions;
}

// Nucleo puro (testavel): classifica cada linha do banco contra as versoes do repositorio.
function compare(dbRows, repo) {
  const results = [];
  const dbNames = new Set();
  for (const row of dbRows) {
    dbNames.add(row.migration_name);
    const entry = repo.get(row.migration_name);
    const flags = [];
    if (!row.finished_at) flags.push('NAO_CONCLUIDA');
    if (row.rolled_back_at) flags.push('REVERTIDA');
    if (!entry) { results.push({ migration: row.migration_name, status: 'NAO_EXISTE_NO_REPOSITORIO', dbChecksum: row.checksum, flags }); continue; }
    if (row.checksum === entry.current) { results.push({ migration: row.migration_name, status: flags.length ? 'IGUAL_MAS_COM_PROBLEMA' : 'IGUAL', dbChecksum: row.checksum, flags }); continue; }
    // mesmo conteudo, so' o fim de linha (CRLF x LF) difere: nao e divergencia de SQL
    if (entry.currentVariants.includes(row.checksum)) { results.push({ migration: row.migration_name, status: flags.length ? 'IGUAL_MAS_COM_PROBLEMA' : 'IGUAL_FIM_DE_LINHA_DIFERENTE', dbChecksum: row.checksum, flags }); continue; }
    const match = entry.history.find((version) => version.checksum === row.checksum || (version.variants ?? []).includes(row.checksum));
    results.push(match
      ? { migration: row.migration_name, status: 'VERSAO_ANTIGA_APLICADA', dbChecksum: row.checksum, currentChecksum: entry.current, appliedVersion: match, flags }
      : { migration: row.migration_name, status: 'CHECKSUM_DESCONHECIDO', dbChecksum: row.checksum, currentChecksum: entry.current, flags });
  }
  for (const [name] of repo) if (!dbNames.has(name)) results.push({ migration: name, status: 'NAO_APLICADA_NO_BANCO', flags: [] });
  return results.sort((a, b) => a.migration.localeCompare(b.migration));
}

function loadRepo(repoRoot, migrationsDir) {
  const repo = new Map();
  for (const entry of readdirSync(migrationsDir, { withFileTypes: true })) {
    const file = join(migrationsDir, entry.name, 'migration.sql');
    if (!entry.isDirectory() || !existsSync(file)) continue;
    // checksum da versao ATUAL = bytes do arquivo no repositorio (o que o deploy aplica). O working tree pode ter fim de linha diferente do
    // git: usa o blob de HEAD quando disponivel, senao o arquivo.
    const relPath = relative(repoRoot, file).split('\\').join('/');
    let content;
    try { content = git(['show', `HEAD:${relPath}`], repoRoot); } catch { content = readFileSync(file); }
    const variants = lineEndingVariants(content);
    repo.set(entry.name, { current: sha256(content), currentVariants: [variants.lf, variants.crlf], history: historicalVersions(repoRoot, relPath) });
  }
  return repo;
}

function main() {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const input = args.find((arg) => !arg.startsWith('--'));
  if (!input || !existsSync(input)) {
    console.error('Uso: node scripts/verify-migration-checksums.cjs <arquivo-json-da-consulta> [--json]\nGere o arquivo com scripts/verify-migrations-production.sql (somente leitura).');
    process.exit(2);
  }
  let rows;
  try {
    const parsed = JSON.parse(readFileSync(input, 'utf8').replace(/^\uFEFF/, ''));
    rows = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.rows) ? parsed.rows : null;
    if (!rows || rows.some((row) => !row || typeof row.migration_name !== 'string' || typeof row.checksum !== 'string')) throw new Error('formato');
  } catch { console.error('Arquivo de entrada invalido: esperado um array JSON com migration_name e checksum (saida de verify-migrations-production.sql).'); process.exit(2); }

  const migrationsDir = resolve(__dirname, '..', 'prisma', 'migrations');
  const repoRoot = git(['rev-parse', '--show-toplevel'], resolve(__dirname)).toString('utf8').trim();
  const results = compare(rows, loadRepo(repoRoot, migrationsDir));
  const problems = results.filter((r) => r.status !== 'IGUAL' && r.status !== 'IGUAL_FIM_DE_LINHA_DIFERENTE');
  if (asJson) console.log(JSON.stringify({ total: results.length, problems: problems.length, results }, null, 2));
  else {
    for (const r of results) {
      const extra = r.appliedVersion ? ` (aplicada a versao ${r.appliedVersion.commit} de ${r.appliedVersion.date}: "${r.appliedVersion.subject}")` : r.flags.length ? ` [${r.flags.join(', ')}]` : '';
      console.log(`${r.status.padEnd(28)} ${r.migration}${extra}`);
    }
    console.log(`\n${results.length} migration(s) verificada(s); ${problems.length} diferente(s) do arquivo atual do repositorio.`);
    if (problems.length > 0) console.log('Cada linha diferente precisa de decisao ANTES do deploy. Nenhuma migration antiga deve ser reescrita automaticamente.');
  }
  process.exit(problems.length === 0 ? 0 : 1);
}

module.exports = { compare, sha256, historicalVersions, loadRepo };
if (require.main === module) main();
