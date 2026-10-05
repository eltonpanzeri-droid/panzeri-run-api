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
3. **Bucket → Settings → Object lifecycle rules → Add rule**: prefixo `panzeri-backups/db/`, ação *Delete uploaded objects after* **14 days**. (O código já apaga; a regra é a redundância caso o servidor pare de rodar.)

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

## Restauração

Use **sempre** a CLI: ela faz `pg_restore` **e** a etapa pós-restauração juntos; não há opção para pular a segunda. Nunca rode `pg_restore` direto.

Pré-requisitos: `postgresql-client-17` (mesma major do servidor), projeto compilado (`pnpm build`), variáveis `R2_*` e `BACKUP_ENCRYPTION_KEY` no ambiente.

```bash
# 1. escolher o backup
pnpm backup:cli list

# 2. baixar e descriptografar (gera arquivo.dump e arquivo.dump.enc; apague os dois depois)
pnpm backup:cli download --key panzeri-backups/db/<objeto>.dump.enc --out arquivo.dump

# 3. restaurar no banco de DESTINO (nunca a DATABASE_URL de produção; a CLI recusa se forem iguais)
TARGET_DATABASE_URL="postgresql://..." pnpm backup:cli restore --dump arquivo.dump --yes
```

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
- **Dados de provider excluídos depois do snapshot** (exclusão pelo aluno em *Privacidade e dados*) e **contas excluídas depois do snapshot** voltam com o backup. A correção depende do ledger de tombstones (proposta pendente de aprovação). Até lá, após qualquer restauração, reexecute as exclusões conhecidas manualmente.
- Tokens de reset de senha e de login por link emitidos antes do snapshot e ainda não usados voltam válidos até expirarem.
- Os tokens que o sistema descarta não são revogados nos providers (não há chamadas externas em massa na restauração).

## Incidentes conhecidos (histórico)
- Até 2026-10-05 o backup era um `pg_dump` completo anexado a e-mail via Resend, sem criptografia, sem retenção e com a `DATABASE_URL` visível em mensagens de erro (log, Telegram e resposta HTTP). Substituído por este fluxo.
