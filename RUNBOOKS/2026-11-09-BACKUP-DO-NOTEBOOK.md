# Backup do notebook e da pasta do projeto (09/11/2026)

O backup automático do Panzeri Run protege **o banco de dados** (cópias diárias cifradas no Cloudflare R2). Este documento diz o que protege **o resto**: o código, os documentos e a memória do Claude, que ficam no notebook.

## Mapa: o que está onde e quem protege

| O que | Onde fica | Quem protege | Risco se o notebook estragar |
|---|---|---|---|
| Código e documentos do projeto (`apps/`, PRONTUARIO, FILA, RUNBOOKS...) | `...\OneDrive\Documentos\GitHub\panzeri-run-api` | **GitHub** (depois do Push) e **OneDrive** (a pasta está dentro do OneDrive) | **Só o que ainda não recebeu Push** existe apenas no notebook e no OneDrive |
| Arquivos que o Git não envia de propósito (`Documentação Garmin/`, `.env`, `secrets/`) | Mesma pasta, marcados como "ignorados" | Só o **OneDrive** | Se o OneDrive falhar e o notebook estragar, perdem-se |
| Memória do Claude (decisões e lições) | `C:\Users\elton\.claude\projects\...\memory` (**fora** do OneDrive e do GitHub) | **Ninguém**, até rodar `copiar-memoria-claude-para-onedrive.bat` | Perde-se a memória (o PRONTUARIO e o CLAUDE.md, que estão no GitHub, continuam) |
| Histórico das conversas com o Claude | `C:\Users\elton\.claude\projects\...\*.jsonl` (cerca de 1,4 GB) | **Ninguém** | Perde-se o histórico detalhado; as decisões importantes estão no PRONTUARIO |
| Senhas e chaves (`BACKUP_ENCRYPTION_KEY`, banco, Resend, Anthropic, Asaas, RevenueCat, R2...) | **EasyPanel** (variáveis) | Você: **gerenciador de senhas** | Sem a `BACKUP_ENCRYPTION_KEY`, **nenhuma cópia do banco pode ser aberta** |
| Banco de dados | Servidor (EasyPanel) | Backup diário no R2 (14 dias) | Coberto; teste de restauração a cada 3 meses |

## O que fazer (hábitos)

1. **Ao final de cada sessão de trabalho:** dar o **Push** no GitHub Desktop. Antes disso o trabalho só existe no notebook.
2. **Uma vez por semana:** dar dois cliques em `copiar-memoria-claude-para-onedrive.bat` (só copia, nunca apaga). Isso leva a memória do Claude para `OneDrive\Documentos\Backup-Memoria-Claude`.
3. **Uma vez (e sempre que uma chave mudar):** guardar as chaves do `INVENTARIO_DE_SEGREDOS.md` num gerenciador de senhas (Bitwarden, 1Password ou similar), principalmente a `BACKUP_ENCRYPTION_KEY`. O Claude nunca vê nem guarda os valores.
4. **Conta do GitHub:** ligar a verificação em duas etapas, se ainda não estiver ligada.
5. **Uma vez por ano (ou a cada troca de notebook):** ensaio de recuperação: baixar o projeto do GitHub numa pasta nova e conferir que abre e compila.
6. **Opcional:** uma cópia do mês numa unidade externa ou em outra nuvem, com a pasta do projeto e a pasta `Backup-Memoria-Claude`.

## Cuidados

- A pasta `.git` dentro do OneDrive funciona, mas o OneDrive pode reclamar de conflitos se dois computadores mexerem na mesma pasta ao mesmo tempo. Trabalhe em um computador de cada vez.
- Não guardar senhas dentro da pasta do projeto: ela vai para o GitHub e para o OneDrive.
- A revisão mensal do backup (aviso do Telegram no dia 2) inclui um lembrete destes itens.
