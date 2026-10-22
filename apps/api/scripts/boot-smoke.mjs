// Teste de FUMACA de inicializacao da API (criado apos o incidente de 22/10/2026, em que um modulo novo mudou a ordem de carregamento, criou uma dependencia circular e a API nao subiu
// em producao, embora todos os testes unitarios passassem). Compila e sobe a aplicacao COM BANCO FALSO e confere que a injecao de dependencias resolve e as rotas sao mapeadas.
// Nao toca em nenhum banco real. Uso: `pnpm --filter api run smoke:boot` (rodar ANTES de pedir deploy quando mexer em modulos, providers ou imports).
import { spawnSync } from 'node:child_process';
import { rmSync, mkdtempSync } from 'node:fs';

import { join } from 'node:path';

const out = mkdtempSync(join(process.cwd(), '.tmp-boot-'));
const build = spawnSync('npx', ['tsc', '-p', 'tsconfig.build.json', '--outDir', out], { stdio: 'inherit', shell: true });
if (build.status !== 0) { console.error('FALHOU: a compilacao nao passou.'); process.exit(1); }
const run = spawnSync('node', [join(out, 'main.js')], {
  encoding: 'utf8', timeout: 45_000, env: { ...process.env, DATABASE_URL: 'postgresql://x:x@127.0.0.1:1/x', JWT_ACCESS_SECRET: 'smoke', JWT_REFRESH_SECRET: 'smoke', PORT: '3992' },
});
const log = `${run.stdout ?? ''}\n${run.stderr ?? ''}`;
rmSync(out, { recursive: true, force: true });
const di = log.match(/Nest can't resolve dependencies[^\n]*/) ?? log.match(/undefined dependency[^\n]*/);
if (di) { console.error(`FALHOU: erro de injecao de dependencias.\n${di[0]}`); process.exit(1); }
if (!/Mapped \{\/health, GET\}/.test(log)) { console.error('FALHOU: a aplicacao nao chegou a mapear as rotas.\n' + log.slice(-1500)); process.exit(1); }
console.log('OK: dependencias resolvidas e rotas mapeadas.');
