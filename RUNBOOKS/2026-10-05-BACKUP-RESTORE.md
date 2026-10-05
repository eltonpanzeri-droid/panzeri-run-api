# Backup e restauração do banco — Panzeri Run

Atualizado em 2026-10-05 (Bloco pré-Garmin 4). Substitui o backup por e-mail.

## Como o backup funciona

`PostgreSQL → pg_dump temporário → AES-256-GCM → upload no Cloudflare R2 → conferência → remoção do temporário`

- Roda todo dia às 07:00 UTC (04:00 em São Paulo) e sob demanda em `POST /coach/backup/run` (**somente admin**).
- O dump em claro nunca sai do servidor e é apagado assim que o arquivo cifrado existe. **Nada é enviado por e-mail.** O Resend só envia e-mails normais do produto.
- A senha do banco nunca aparece em comando, log, Telegram, resposta HTTP nem metadados: `pg_dump` roda sem shell, com a conexão passada por variáveis `PG*` do processo, e todo erro passa por sanitização.
- Objetos: `panzeri-backups/db/AAAAMMDDTHHMMSSZ-<8 hex>.dump.enc` (sem dados pessoais no nome). Metadados: só `format` e `created`.
- Retenção de **14 dias**, aplicada pelo código após cada backup bem-sucedido (apaga só objetos antigos com o prefixo acima, nunca o recém-enviado). Recomendado também configurar a regra de ciclo de vida no bucket (abaixo) como segunda camada.

## Configuração (uma vez)

### Cloudflare R2 (painel)
1. **R2 → Create bucket**, nome sugerido `panzeri-run-backups`. Manter **privado**: sem domínio público e sem acesso `r2.dev`.
2. **R2 → Manage R2 API Tokens → Create API token**: permissão **Object Read & Write**, escopo **somente este bucket**. Copie o *Access Key ID* e o *Secret Access Key* (o segredo aparece uma vez). O *Account ID* está na página inicial do R2.
3. **Bucket → Settings → Object lifecycle rules** — crie **duas regras independentes** (os prefixos não se sobrepõem; a regra dos dumps não alcança os tombstones):
   - `panzeri-backups/db/` → *Delete uploaded objects after* **14 days** (o código também apaga; a regra é redundância caso o servidor pare de rodar).
   - `panzeri-backups/tombstones/` → *Delete uploaded objects after* **365 days**. **Esta regra é a única que expira tombstones: o código nunca os apaga.**
   Confirme no painel que nenhuma regra tem prefixo vazio ou `panzeri-backups/`.

### EasyPanel (variáveis de ambiente da API)
| Variável | Valor |
|---|---|
| `BACKUP_ENCRYPTION_KEY` | 64 caracteres hex. Gerar: `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `R2_ACCOUNT_ID` | Account ID da Cloudflare |
| `R2_BUCKET` | nome do bucket |
| `R2_ACCESS_KEY_ID` | do token criado |
| `R2_SECRET_ACCESS_KEY` | do token criado |

`BACKUP_EMAIL_TO` não é mais usada (pode remover). `ADMIN_EMAILS` precisa estar definida para disparar o backup manual.

### ⚠ A chave de criptografia
- `BACKUP_ENCRYPTION_KEY` é **independente** da chave do Polar e **nunca** vai para o banco, o arquivo, o nome do objeto, o log ou os metadados.
- **Guarde uma cópia fora do servidor (gerenciador de senhas).** Se a chave for perdida, **todos os backups ficam irrecuperáveis**. Se for trocada, os backups antigos só abrem com a chave antiga.

## Validação inicial (antes de apagar qualquer backup antigo)
1. Deploy; como admin, chamar **Gerar backup agora** (ou `POST /coach/backup/run`) e conferir `ok: true`.
2. `pnpm backup:cli list` (com as variáveis `R2_*` e `BACKUP_ENCRYPTION_KEY` no ambiente) deve listar o objeto.
3. Fazer um **ensaio de restauração** em um banco descartável (abaixo). Só depois validar é que os backups antigos por e-mail são apagados **manualmente** (caixa de entrada e histórico do Resend).

## Tombstones (exclusões que a restauração não pode desfazer)

- Ledger **fora do PostgreSQL**, no mesmo bucket, em `panzeri-backups/tombstones/AAAAMMDDTHHMMSSZ-<8 hex>.tomb.enc`. Conteúdo: JSON cifrado (AES-256-GCM, mesma `BACKUP_ENCRYPTION_KEY`, cabeçalho `PZTB1`) com `v`, `type`, `userId`, `provider` (quando se aplica) e `at`. Sem nome, e-mail, CPF ou conteúdo.
- **Ordem obrigatória:** `tombstone gravado e confirmado no R2 → exclusão local`. Se o R2 não confirmar, a exclusão falha com 503 ("nada foi apagado") e um alerta vai ao Telegram. Se a exclusão local falhar depois do tombstone, o tombstone fica (seguro), o evento é auditado e há alerta.
- Criado hoje: exclusão de dados de provider (`DELETE /polar/data`). **Desconexão simples não gera tombstone:** o fail-closed pós-restauração já desconecta todas as conexões restauradas, então ele não acrescentaria nada.
- Pendente: exclusão de conta (ver abaixo). O tipo `account_deleted` já é aceito no formato, mas **não tem executor**: um tombstone desse tipo mantém a restauração como pendente.

## Restauração

Use **sempre** a CLI: ela faz `pg_restore` **e** a etapa pós-restauração juntos; não há opção para pular a segunda. Nunca rode `pg_restore` direto.

Fluxo do `restore`: `decrypt (download) → pg_restore → fail-closed das integrações → carregar tombstones → reaplicar exclusões posteriores ao snapshot`.

Pré-requisitos: `postgresql-client-17` (mesma major do servidor), projeto compilado (`pnpm build`), variáveis `R2_*` e `BACKUP_ENCRYPTION_KEY` no ambiente.

```bash
# 1. escolher o backup
pnpm backup:cli list

# 2. baixar e descriptografar (gera arquivo.dump, arquivo.dump.enc e arquivo.dump.snapshot.json; apague depois)
#    O .snapshot.json guarda a data REAL do snapshot (início do pg_dump, metadado gravado pelo backup no R2).
pnpm backup:cli download --key panzeri-backups/db/<objeto>.dump.enc --out arquivo.dump

# 3. restaurar no banco de DESTINO (nunca a DATABASE_URL de produção; a CLI recusa se forem iguais)
TARGET_DATABASE_URL="postgresql://..." pnpm backup:cli restore --dump arquivo.dump --yes
```
Sem o `.snapshot.json` a CLI exige `--snapshot-at <ISO>` explícito; a data nunca é inferida de texto livre.

### Se o ledger (R2) estiver indisponível na restauração
A restauração **não é declarada concluída**: a CLI imprime `RESTAURACAO NAO CONCLUIDA`, sai com código **2** e o banco permanece em **fail-closed** (integrações desconectadas). **Não libere o sistema aos alunos.** Quando o R2 voltar, retome (idempotente):
```bash
TARGET_DATABASE_URL="postgresql://..." pnpm backup:cli apply-tombstones --dump arquivo.dump --yes
```
São reaplicados só os tombstones posteriores ao snapshot, com margem de 5 min antes dele (a exclusão grava o tombstone e só depois apaga, com teto de 60 s).

### Etapa pós-restauração (automática no `restore`; também disponível isolada e idempotente)
```bash
TARGET_DATABASE_URL="postgresql://..." pnpm backup:cli post-restore --yes
```
Regra **fail closed**: o snapshot pode conter autorizações que o usuário revogou depois dele. A etapa, só no banco local e sem chamar Polar/Strava:
- **Polar:** toda conexão ativa vira desconectada (`disconnectedAt`), com token, transaction e registro apagados. O aluno precisa autorizar de novo.
- **Strava:** as linhas de `StravaConnection` (tokens) são removidas; sem a linha o sistema não sincroniza (é assim que a desconexão do Strava já funciona).
- Registra um evento de auditoria (`post_restore_safeguard`) só com contagens.

Depois de restaurar em produção: avisar os alunos para reconectar Polar e Strava.

## O que a restauração NÃO resolve ainda
- **Contas excluídas depois do snapshot** voltam com o backup: a exclusão de conta ainda não existe como operação (bloqueio de decisão: o `User` não pode ser apagado sem perder os registros de pagamento que a Política manda reter — `BillingEvent` tem `onDelete: Restrict`). Até lá, após qualquer restauração, reexecute manualmente as exclusões de conta conhecidas.
- Dados de provider excluídos depois do snapshot **são** reaplicados pelo ledger (acima).
- Tokens de reset de senha e de login por link emitidos antes do snapshot e ainda não usados voltam válidos até expirarem.
- Os tokens que o sistema descarta não são revogados nos providers (não há chamadas externas em massa na restauração).

## Incidentes conhecidos (histórico)
- Até 2026-10-05 o backup era um `pg_dump` completo anexado a e-mail via Resend, sem criptografia, sem retenção e com a `DATABASE_URL` visível em mensagens de erro (log, Telegram e resposta HTTP). Substituído por este fluxo.
