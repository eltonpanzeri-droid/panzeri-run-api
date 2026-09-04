# RELATÓRIO — ORDEM ELTON² 001 (Lote 0.1)

**Escopo executado:** somente inventário/leitura, conforme instruído. Nenhum sync, deploy, commit,
push, correção, rotação de credencial ou alteração de configuração foi realizado durante esta
tarefa. Todos os comandos usados foram de leitura (`cat`, `ls`, `git status/log/remote`, `node -e`
para parsear JSON, `find`, `grep`).

**Data/hora da coleta:** 2026-09-04, sessão local do Claude Code no ambiente Windows do Elton.

---

## ACHADO CRÍTICO — reportar primeiro

Durante o inventário de permissões (item 4), foram encontradas **duas credenciais reais em texto
plano** dentro do arquivo de permissões do projeto (não é um arquivo de segredos — é a lista de
comandos pré-aprovados do Claude Code). Isso não é um segredo intencionalmente armazenado; é
resíduo de comandos `curl`/`git` executados em sessões anteriores que ficaram registrados como
"regra de permissão aprovada" porque continham o comando inteiro, incluindo o valor da credencial.

- **Local exato:** `.claude/settings.local.json`, dentro do array `permissions.allow`.
- **O que é:** uma chave de API da Anthropic (prefixo `sk-ant-api03-...`, ~90 caracteres) embutida
  numa regra de permissão para um comando `curl` de teste; e um token de acesso pessoal do GitHub
  (prefixo `ghp_...`, 40 caracteres) embutido em duas regras diferentes (`Invoke-WebRequest` e
  `git push` com header de autorização manual).
- **Não reproduzido aqui** — só os prefixos acima, por instrução explícita da Ordem.
- **Risco:** qualquer pessoa com acesso de leitura a este arquivo (ou a um backup/sync dele) tem as
  duas credenciais completas. `settings.local.json` **não é sincronizado para o Git** (confirmado
  no item 6) e vive só na máquina local — mas ainda assim é um vazamento de segredo fora do lugar
  correto (deveria estar só em `.env`, nunca em arquivo de permissões).
- **Conforme instruído, nada foi alterado.** Recomendação para o próximo lote: rotacionar as duas
  credenciais (a chave Anthropic e o token do GitHub) assim que a Ordem seguinte autorizar, e
  limpar essas entradas específicas do array de permissões.

---

## 1. Versão do Claude Code e fontes de configuração

- **CLI instalado:** `claude --version` → `2.1.210 (Claude Code)`.
- **Observação:** o pacote de skills embutido carregado nesta sessão se identifica internamente
  como `2.1.219` (caminho `bundled:claude-skills` referenciado em runtime). Não investiguei a fundo
  a causa dessa diferença de numeração (CLI vs. bundle de skills) — pode ser normal (versionamento
  independente de skills vs. núcleo) ou indicar um componente desatualizado. Fica como pergunta em
  aberto para o ELTON².
- **Fontes de configuração identificadas, em ordem de escopo:**
  1. `~/.claude/settings.json` (global, todo o usuário) — só contém `autoUpdatesChannel` e `theme`.
     Nenhuma permissão configurada aqui.
  2. `~/.claude.json` (global, ~49KB) — configuração de conta, cache de features, e a lista de
     **3 diretórios de projeto "confiados"** (ver item 4b abaixo).
  3. `.claude/settings.local.json` (escopo do projeto Panzeri Run, ~25KB) — **única fonte real das
     regras de permissão** (ver item 4). Não versionado no Git (confirmado no `.gitignore`... na
     verdade nem chega a ser avaliado pelo Git, pois o projeto-fonte não é um repositório Git ativo
     — ver item 6).
  4. `CLAUDE.md` — **não existe** em nenhum lugar (nem `~/CLAUDE.md`, nem na raiz do projeto, nem em
     subpastas até 3 níveis). Não há instruções de projeto persistentes nesse mecanismo hoje.
  5. **Hooks** — não configurados (`hooks` ausente em `settings.local.json`).
  6. **Skills customizadas do projeto** — nenhuma pasta `.claude/skills/` encontrada no projeto.
  7. **MCP servers** — nenhum servidor MCP com credenciais armazenadas localmente nos 3 diretórios
     de projeto rastreados (todos com `mcpServers: []` ou ausente). Os servidores MCP disponíveis
     nesta sessão (browser, sessão, visualização etc.) são providos pelo aplicativo host (Claude
     Code desktop), não por configuração local editável neste ambiente.

## 2. Backup local das configurações

Não foi feito backup nesta execução — a Ordem pede "backup local protegido das configurações
necessárias" mas não especifica destino, e criar um novo arquivo fora do já resguardado
`.claude/backups/` (mecanismo próprio do Claude Code, já existente e não tocado) exigiria decidir
um local — o que passaria de "inventariar" para "agir" sem uma instrução explícita de onde. Fica
registrado como pendência explícita: **decidir e executar o backup é a primeira ação recomendada do
próximo lote**, não feita aqui para não extrapolar o escopo read-only desta Ordem.

## 3. Inventário de permissões (redigido)

Fonte única: `.claude/settings.local.json` → `permissions.allow` (173 entradas).
`permissions.ask` e `permissions.deny` estão **vazios** — ou seja, hoje o controle de acesso do
Claude Code neste projeto é 100% via lista de permissão (allow-list) explícita; qualquer comando
fora dessa lista cai no comportam7ento padrão do modo de permissão ativo na sessão (pergunta ao
usuário), não há bloqueio automático (`deny`) configurado para nada.

### Classificação por categoria (contagem aproximada das 173 entradas)

| Categoria | Qtd. aprox. | Exemplos | Risco |
|---|---|---|---|
| Build/typecheck/lint (`tsc`, `npm run`, `pnpm`, `expo export`) | ~45 | `npx tsc *`, `pnpm add *` | Baixo |
| Leitura de arquivo (`Read(...)`) | ~8 | `Read(//c/.../apps/api/prisma/**)` | Baixo |
| Diagnóstico de rede/produção (`curl` contra a API real) | ~20 | `curl ... /billing/checkout -d '{"cpf":"..."}'` | **Médio** — alguns testaram endpoints de produção com payloads fictícios; nenhum encontrado com dado real de aluna |
| Git no **mirror** (`status`, `log`, `fetch`) | ~10 | `git -C ".../GitHub/panzeri-run-api" status` | Baixo — só leitura |
| **Git `commit`/`push` genéricos** (`Bash(git add *)`, `Bash(git commit -m ' *)`, `Bash(git push *)`) | 3 | — | **Alto** — são regras **coringa** (wildcard), aprovam qualquer `git add`, `git commit -m "..."` ou `git push` sem revisão futura. Isso contradiz a regra de processo já estabelecida (memória do projeto) de que "a IA nunca commita/pusha sozinha, só roda o `.bat` de sync". Ver observação abaixo. |
| Execução do `.bat` de sincronização | ~5 | `atualizar-github-panzeri-run.bat` | Médio — é o mecanismo oficial de sync, mas está pré-aprovado sem pedir confirmação a cada uso |
| **Credencial exposta na própria regra** (ver Achado Crítico) | 2 | `curl ... -H 'x-api-key: sk-ant-...'`, `Invoke-WebRequest ... 'token ghp_...'` | **Crítico** |
| Comandos de outro projeto (Estúdio Panzeri Fitness — `git push`, SSH keys) | ~20 | `ssh -i ...id_github_estudio ...` | Médio — fora do escopo do Panzeri Run, mas mostra que o allow-list é **compartilhado entre projetos diferentes** (ver observação) |
| Utilitários diversos (`node -v`, `winget`, `python3`, `markitdown`) | ~15 | — | Baixo |
| Skills/MCP (`Skill(claude-api)`, `mcp__visualize__*`) | ~5 | — | Baixo |
| Outros (grep/awk/find pontuais, já cumpridos) | ~40 | — | Baixo |

### Observações de governança sobre as permissões

- **As 3 regras de `git add *` / `git commit -m ' *` / `git push *` são o achado mais preocupante
  depois do vazamento de credencial.** São coringas amplos: uma vez aprovados, qualquer sessão
  futura do Claude Code neste mesmo perfil de usuário pode rodar `git commit`/`git push` **sem
  pedir confirmação nova**, em qualquer repositório acessível — isso vale tanto pro Panzeri Run
  quanto pro Estúdio Panzeri Fitness (mesmo perfil). Isso está em tensão direta com a regra de
  processo que o Elton estabeleceu explicitamente ("nunca `git commit`/`push` sozinho — só o
  usuário, pelo GitHub Desktop"). A regra de processo *foi seguida* nesta sessão (nenhum
  commit/push real foi feito por mim, mesmo estando pré-aprovado) — mas a permissão que
  *tecnicamente permitiria* o contrário está lá, ativa.
- **O allow-list é único por usuário/máquina, não por projeto** — comandos aprovados numa sessão
  trabalhando no Estúdio Panzeri Fitness continuam válidos numa sessão do Panzeri Run e
  vice-versa (confirmado pelas ~20 entradas do Estúdio presentes neste arquivo, que fisicamente
  vive dentro da pasta do Panzeri Run). Não há isolamento de permissão entre os dois produtos.
- Nenhuma entrada de `deny` existe — não há nenhum comando explicitamente bloqueado hoje (ex.: não
  há uma regra proibindo `rm -rf`, `DROP TABLE`, ou acesso direto ao `DATABASE_URL` de produção).
  A proteção contra essas ações hoje depende inteiramente de instrução comportamental (memória do
  projeto, este próprio prompt), não de um controle técnico no `deny`.

## 4. Credenciais — localização (sem reprodução de valores)

| O quê | Onde | No Git? |
|---|---|---|
| Chave de API da Anthropic + token do GitHub (vazados) | `.claude/settings.local.json` → `permissions.allow` | Não (arquivo não versionado — projeto-fonte não é repo Git ativo, ver item 6) |
| Credencial OAuth do próprio Claude Code | `~/.claude/.credentials.json` | Não (fora da pasta do projeto) |
| Variáveis de ambiente reais (Asaas, Anthropic, Resend, Telegram, RevenueCat, etc.) | `.env` na raiz do projeto-fonte | **Não** — confirmado no `.gitignore` (linhas 7-8: `.env`, `.env.local`) tanto no projeto-fonte quanto no mirror. `git log`/`git ls-files` no mirror não mostram nenhum commit histórico desses arquivos. |
| Chaves Apple (.p8) e chave de conta de serviço Google (JSON) | pasta `secrets/` na raiz do projeto-fonte | **Não** — `.gitignore` linha 11 (`secrets/`) confirmado nos dois repositórios; sem histórico de commit. |
| `.env.example` (só placeholders, sem segredo real) | raiz do projeto-fonte e do mirror | Sim, intencionalmente (é o template) |

**Resumo:** a única exposição real de credencial encontrada foi a do Achado Crítico (item acima).
O restante do fluxo de segredos (`.env`, `secrets/`) está corretamente fora do controle de versão
nos dois repositórios, sem histórico de vazamento.

## 5. Fonte canônica, espelho e sincronização

- **Fonte canônica (onde o Elton e a IA trabalham de verdade):**
  `C:\Users\elton\OneDrive\Documentos\Aplicativo Panzeri Run` — **não é um repositório Git
  funcional** (existe uma pasta `.git/` incompleta, só com um subdiretório `info/` vazio, sem
  `HEAD`/`objects`/`refs` — `git status` nessa pasta retorna "not a git repository". É resíduo
  inofensivo de uma inicialização incompleta, não um repo ativo).
- **Espelho Git:** `C:\Users\elton\OneDrive\Documentos\GitHub\panzeri-run-api`, remoto
  `https://github.com/eltonpanzeri-droid/panzeri-run-api.git`, branch atual `main` (mais 3 branches
  secundárias: `identidade-visual`, `identidade-visual-fase2b`, `semana-avisos-menu`).
- **Mecanismo de sincronização:** script `atualizar-github-panzeri-run.bat` na raiz da pasta-fonte,
  que copia uma **lista fixa (hardcoded) de arquivos/pastas** da fonte para o mirror. **Achado já
  conhecido e registrado em sessão anterior:** essa lista fica desatualizada com o tempo — pelo
  menos 4 arquivos/migrações novas precisaram ser copiados manualmente nas últimas sessões porque
  o `.bat` não os incluía. Isso significa que, **hoje, uma mudança de código só chega no mirror com
  certeza se alguém (a IA) confirmar manualmente que o arquivo tem uma linha `copy /Y`
  correspondente no `.bat`** — não é uma sincronização completa automática.
- **Commit/push:** feitos manualmente pelo Elton, via GitHub Desktop, depois que a IA roda o `.bat`.
  A IA nunca executa `git commit`/`git push` diretamente (comportamento confirmado nesta sessão),
  apesar de existirem regras de permissão coringa que tecnicamente permitiriam (ver item 3).
- **Deploy:** a aplicação de produção (EasyPanel) executa `pnpm db:migrate:deploy && pnpm
  start:prod` no container (confirmado no `Dockerfile` da raiz) — ou seja, **migrações do Prisma
  rodam automaticamente a cada deploy**, sem passo manual adicional além do push que dispara o
  deploy no EasyPanel.

---

## Pendências explícitas para o próximo lote (nada disso foi executado aqui)

1. Rotacionar a chave de API da Anthropic e o token do GitHub expostos no Achado Crítico.
2. Remover as entradas específicas de `permissions.allow` que contêm as credenciais.
3. Decidir se as 3 regras coringa de `git add *` / `git commit -m ' *` / `git push *` devem ser
   removidas do allow-list (recomendação: sim, para manter o controle técnico alinhado com a regra
   de processo já em vigor).
4. Decidir um formato/local de backup protegido das configurações (item 2 desta Ordem, não
   executado por falta de destino especificado).
5. Investigar a causa da divergência de versão CLI (`2.1.210`) vs. bundle de skills (`2.1.219`).
6. Decidir se o resíduo `.git/info` vazio na pasta-fonte deve ser removido (inofensivo, mas
   confuso).
7. Avaliar isolar o allow-list por projeto, já que hoje ele é compartilhado entre Panzeri Run e
   Estúdio Panzeri Fitness sem intenção explícita disso.

---

*Nenhuma alteração foi feita no ambiente durante a geração deste relatório. Nenhum segredo foi
reproduzido. Este relatório não constitui aprovação própria — aguardando julgamento externo do
ELTON² antes de qualquer novo lote.*
