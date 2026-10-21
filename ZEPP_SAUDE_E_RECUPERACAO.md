# Zepp/Amazfit — saúde e recuperação (sono, diário, HRV) — 21/10/2026

Documento operacional da integração completa. Fonte técnica: documentação oficial da Zepp (devopen.zepp.com: Sleep Events, Dailies Events, HRV Events, Activity Events, Download FIT) e a tela "Data Access" do portal (serviço **Panzeri Run**, status **Approved**, tipo **Health Data Collaboration**, local dos dados **Brasil**, Push Data **Enable**, validade até 15/10/2056).

## 1. O que a Zepp disponibiliza (e o que o contrato do Panzeri Run cobre)

| Categoria | Evento Zepp | Campos entregues (documentação) | Previsto no "Requested Data Items" aprovado? |
|---|---|---|---|
| Atividades | Activity Events (ping → download do FIT) | modalidade, data/hora, distância, duração, ritmo, calorias, FC, cadência, potência, elevação, série temporal, GPS | **Sim** (Sport: distância/calorias/tempo; Sport Detail: GPS) |
| Sono | Sleep Events (push) | início, duração, sono profundo/leve/REM/acordado, segmentos por etapa, cochilos, pontuação, validação | **Sim** (Sleep: profundo, leve, acordado, pontuação, início/fim, cochilo, REM) |
| Diário | Dailies Events (push) — página marcada **"[Upcoming]"** | passos, distância, calorias ativas, **FC de repouso**, meta de passos | **Sim** (Sport: passos/distância/calorias; "Resting heart rate" listada) — **confirmar disponibilidade com a Zepp** |
| HRV | HRV Events (push) | média de HRV da noite (`lastNightAvg`, **unidade não especificada**), valores finos | **NÃO consta** no "Requested Data Items" — **pedir à Zepp a inclusão** |
| Perfil | User Profile API | (não implementado: o Panzeri Run só usa o identificador da conta) | Sim (User Data) — não usado |
| Em breve (Zepp) | Temperatura da pele, SpO2, composição corporal, nutrição, Hybrid Charge | — | Não |

Regras que valem para todas: o evento de **sono não traz FC de repouso** (ela só vem do diário); `summaryId` pode ser nulo; a identidade é aluno + dia local + início; nada é estimado, convertido ou completado.

## 2. O que já está implementado (local, sem deploy)

| Categoria | Recebe | Armazena | Atlas já usa |
|---|---|---|---|
| Atividades + sensores + GPS | sim (já existia) | `ActivityLog` + séries | sim (resumos; GPS e série nunca vão à IA) |
| Sono | sim (`sleeps`) | `WearableSleepSummary` | sim: duração, profundo, leve, REM, acordado, cochilos, pontuação (minutos = segundos ÷ 60, sem arredondar) |
| Diário | sim (`dailies`) | `WearableDailySummary` | sim: FC de repouso, passos, calorias ativas |
| HRV | sim (`hrv`) | `WearableHrvSummary` | sim: média da noite (unidade da Zepp, sem conversão) |

- Consentimento 2.1: grupos novos **Sono e recuperação**, **Saúde diária** (passos, distância, calorias ativas, FC de repouso) e **HRV**, cada um independente; nada vem marcado; atalho "Marcar todos os grupos" feito pelo aluno. Atlas (tela v1.1) segue explícito, separado e opcional.
- IA: dado de saúde só entra quando a **categoria** está autorizada **e** o Atlas foi autorizado **e** `ZEPP_EXTERNAL_AI_ENABLED` está ligada. Retirar a categoria no meio da geração aborta a chamada. Sem escopo = bloqueado (fail-closed). Observações levam provedor, resumo de origem e dia.
- Exclusão dos dados Zepp e da conta apagam os três resumos novos.

## 3. Migrations (2, ambas aditivas)

1. `20261021200000_wearable_health_summaries` — cria `WearableSleepSummary`, `WearableDailySummary`, `WearableHrvSummary` (commit 61a0d8e, ja enviado ao GitHub; se a API subiu depois dele, a subida (`prisma migrate deploy`) ja a aplicou — confirmar com a consulta de verificacao).
2. `20261021210000_wearable_metric_records_and_sleep_extras` — NOVA: acrescenta 3 colunas ao sono (`sleepScores`, `respirationOffsetSec`, `spo2OffsetSec`) e cria `WearableMetricRecord` (receptor generico dos indicadores que a Zepp ja preve: SpO2, temperatura da pele, composicao corporal, nutricao, carga de estilo de vida). Nenhuma tabela existente perde nada.

Consulta de verificacao (so leitura): `SELECT migration_name, finished_at FROM _prisma_migrations WHERE migration_name LIKE '20261021%' ORDER BY 1;`. Backup antes de publicar.

## 4. Cadastro dos callbacks no portal da Zepp (ação sua)

A documentação pública **não descreve a tela** de cadastro de callbacks ("Configure Callback Endpoint" é o passo 7 da jornada, no Developer Console `console.zepp.com`). O que o servidor aceita:

- **Uma única URL serve para todos os tipos**: o corpo diz o tipo (`activityFiles`, `sleeps`, `dailies`, `hrv`, `authorizationChange`). Cadastre a **mesma URL** em cada callback que aparecer como *Unconfigured* (Activity, Sleep, HRV e Daily, se existir):
  `https://agenteselton-panzeri-run-api.hbljgk.easypanel.host/integrations/zepp/webhook/<valor de ZEPP_WEBHOOK_SECRET>`
- HTTPS, método POST, `text/plain` (array JSON de strings), resposta **204** em milissegundos. Sem assinatura/HMAC: a proteção é o segredo no caminho (rotação: dois segredos separados por vírgula em `ZEPP_WEBHOOK_SECRET`).
- Chamada de teste sem corpo recebe 204 (nada é gravado); segredo errado recebe 404.
- Se o portal recusar a URL ou não oferecer um dos três callbacks, envie à Zepp (open-api-support@zepp.com) o texto do erro.

## 5. Pendências com a Zepp (não bloqueiam o resto)

1. **HRV**: pedir a inclusão dos itens de HRV no Data Access do serviço (hoje não consta).
2. **Dailies**: confirmar se o evento diário já está disponível em produção (página "[Upcoming]") — dele vêm passos, calorias ativas e FC de repouso.
3. **Unidade da HRV** e se `lastNightAvg` é a mesma métrica entre modelos de relógio.
4. Reenvio/atualização: a Zepp não documenta se um resumo de sono pode ser reenviado com valores novos; o sistema aceita (mesma identidade = atualiza).
5. **Backfill**: a Backfill API só documenta atividades; sono/diário/HRV chegam só dali em diante (nenhum histórico).

## 6. Ativação em produção (ordem)

1. Commit/push, deploy, migration `20261021200000_wearable_health_summaries` (backup antes).
2. `ZEPP_*` + `ZEPP_WEBHOOK_SECRET` + `PROVIDER_HUB_WORKER_ENABLED=true` + `ZEPP_WORKOUT_PUBLISH_ENABLED=true` + `ZEPP_BACKFILL_ENABLED=true` + `ZEPP_ENABLED_USER_IDS=*`.
3. Cadastrar os callbacks (seção 4).
4. Atlas: só quando você decidir, `ZEPP_EXTERNAL_AI_ENABLED=true`.

## 7. Callbacks "Unconfigured": o que fazer (a documentação pública não descreve a tela)

1. No Developer Console (console.zepp.com) abra **My Service → My Apps → Panzeri Run** e procure a seção de callbacks (nomes possíveis: *Callback*, *Webhook*, *Data Push*). Cadastre a mesma URL do webhook (seção 4) em Activity, Sleep, HRV (e Daily, se existir).
2. Se os campos estiverem somente leitura, não existirem ou o portal recusar a URL, a configuração depende da Zepp (o serviço é do tipo *Health Data Collaboration*). Envie ao Jeff Fu / open-api-support@zepp.com (a URL com o segredo só por canal privado, nunca no e-mail aberto):

> Hello Jeff, our Data Access service "Panzeri Run" is Approved with Push Data enabled, but the callbacks for Activity, Sleep and HRV still show "Unconfigured" in the console. Where do we set the callback URL for each event type, or can your team configure them for us? Our endpoint is HTTPS, accepts POST text/plain (array of JSON strings), returns 204, and handles duplicates; one URL serves all event types (we route by payload key: activityFiles, sleeps, hrv, dailies, authorizationChange). We will share the exact URL privately. Also please confirm: (1) HRV is not listed under "Requested Data Items" — can it be added? (2) Daily Events is marked "[Upcoming]" — is it already delivered in production for our service? (3) Which event types will actually be pushed to us today?
