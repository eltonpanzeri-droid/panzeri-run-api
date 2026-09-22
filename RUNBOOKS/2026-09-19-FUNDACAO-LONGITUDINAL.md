# Fundação longitudinal de rastreamento (19/09/2026)

Objetivo: preservar, de forma determinística, **identidade + tempo + origem + conteúdo + sequência + estado comercial + resultado** de cada jornada, para o Panzeri Intelligence. O Panzeri Run só registra **fatos**; nenhuma conclusão, taxa ou persona é calculada aqui.

## 1. Modelo de identidade

| Identidade | O que é | Onde nasce | Vida útil |
|---|---|---|---|
| `journeyId` | Jornada longitudinal **anônima** | Landing (`localStorage.panzeri_journey_id`) ou, se a pessoa entra direto, o PWA (`AsyncStorage panzeri-run-journey-id`) | Enquanto o storage do navegador existir |
| `sessionId` | Uma sessão específica | Landing: 1 por visita/aba (`sessionStorage.panzeri_session_id`). PWA: `funnelSessionId` (persistente por instalação — comportamento antigo, mantido) | Landing: a aba. PWA: até reinstalar |
| `userId` | A pessoa, depois de se identificar | Cadastro | Permanente |

`journeyId` **nunca** é sinônimo de `sessionId`. Uma jornada tem várias sessões; eventualmente aponta para um `userId`.

**Regra de continuidade (só determinística):** o único elo Landing → PWA é `journey_id` na URL do CTA (origens diferentes não compartilham storage). Sem elo, **não se unem jornadas**. Se a URL trouxer uma jornada diferente da guardada no dispositivo, adota-se a da URL e a anterior fica em `metadata.linkedFromJourneyId` do `app_opened` (o mesmo dispositivo viu as duas).

## 2. Anônimo → identificado

`POST /analytics/link-journey` (JWT, corpo `{journeyId, sessionId?, via}`) grava um `FunnelEvent` `journey_linked` com o **`userId` do JWT** (nunca do corpo). Idempotente por `(userId, journeyId)` via `dedupeKey`. O app chama a cada `accessToken` (cadastro = `via:'signup'`, demais = `login`). Eventos anônimos antigos **não são reescritos** (`userId` continua nulo); o `createdAt` do `journey_linked` é o instante real da associação. Uma pessoa pode ter várias jornadas (vários dispositivos); um dispositivo compartilhado pode ter várias pessoas (`identity:'ambiguous'`, nada é chutado).

`/auth/*` **não foi alterado** (o `ValidationPipe` global usa `forbidNonWhitelisted`; mudar DTO de login/cadastro quebraria clientes de versões diferentes).

## 3. Eventos canônicos (FunnelEvent)

| Evento | Significado exato |
|---|---|
| `landing_view` | A Landing foi carregada. 1 por sessão (`dedupeKey = sessionId:landing_view`). Carrega a origem daquela visita |
| `landing_cta_click` | A pessoa clicou na Landing para **entrar no Panzeri Run**. **Não** é checkout nem `payment_started` |
| `app_opened` | O PWA/app foi aberto. **Não** implica prospect novo |
| `signup_started` / `signup_completed` | Tentou / concluiu o cadastro. `signup_completed` **não** significa assinante |
| `journey_linked` | Vínculo journeyId↔userId (servidor, a partir do JWT) |
| `payment_started` | Intenção/tentativa de iniciar pagamento. **Não** é compra |
| `payment_confirmed` (BillingEvent) | Pagamento confirmado (Asaas, com valor real) |
| `status_changed` (BillingEvent) | Transição de estado comercial |

Origem em `metadata`: `source, medium, campaign, content, term, referrer` (+ `fbclid/gclid` internos, **nunca expostos ao Léo**). Ausência de origem continua ausência (`{}`), nunca vira canal inventado.

## 4. Gerador de Links

`/links` (página isolada, `noindex`, sem instrumentação, histórico só no `localStorage` do navegador — últimos 10). Base `https://eltonpanzeripersonal.com.br/`. Gera `utm_source`, `utm_medium`, `utm_campaign`, `utm_content` (`utm_term` não é oferecido). Normaliza para `a-z0-9_` sem acento. Origens: instagram, whatsapp, facebook, youtube, email, meta_ads, outro. Reaproveitado **sem alteração**; era retrocompatível e continua sendo. **Estava fora do ar desde 16/09** (commit `617788a` removeu a rota) — restaurado.

## 5. Estado comercial temporal

Pergunta: *"no instante T, qual era a relação comercial desta pessoa?"* — nunca o `subscriptionStatus` de hoje.

- Fonte canônica: `BillingEvent` — `baseline_snapshot` (foto por aluno no dia do deploy, com `externalRef` `baseline:had_access|no_access`) + `status_changed` (toda mudança real, gravada em **todos** os pontos que alteram o status: webhooks Asaas/RevenueCat, sync do Asaas, cupom, cancelamento, checkout, painel do treinador). `timestamp` = quando o Panzeri Run **observou** a mudança.
- Regras (`apps/api/src/leo/commercial-state.ts`, testado): `prospect` (nunca teve relação ativa) · `active` (active/manual_active/grace; **atraso não encerra a relação**, o `subscriptionStatus` bruto acompanha) · `ex_subscriber` (já foi ativo e deixou de ser: canceled/pending) · `reactivated` (voltou a ativo **depois de ex**; um `overdue→active` não é reativação) · `unknown`.
- `basis` diz a confiança: `transition_log` (certeza, a partir do baseline/cadastro), `no_account_yet`, `first_paid_bound`, `current_status_unchanged_since`, `insufficient_history`.
- **Primeira compra** (`BillingSubscription.firstPaidAt`) só é gravada na transição real de quem **nunca teve acesso** (`studentCode` nulo) ou de `manual_active → active`. Reativação e renovação **não** são primeira compra (evita "primeira compra" falsa para assinantes antigos).
- Receita: `payment_confirmed` (Asaas, com valor) agora registra **toda** confirmação, inclusive renovações (antes só o pagamento que mudava o status). RevenueCat **não** gera receita (sem valor confiável) — só `firstPaidAt` + `status_changed`.

## 6. Endpoints `/leo/*` (todos `Authorization: Bearer <PANZERI_RUN_INTERNAL_TOKEN>`, somente leitura)

Datas `YYYY-MM-DD`, fronteiras no dia de **Brasília (UTC-3)**.

- `GET /leo/daily-summary?date=` — inalterado + `purchasesAsaas`, `purchasesRevenueCat` (provider da 1ª compra vem do `firstPaidPaymentId`, imutável; `provider` é sobrescrito por checkout/cupom).
- `GET /leo/attribution?from&to` — agregado por `source/medium/campaign` de quem se cadastrou no período; `withAttribution + withoutAttribution = totalStudents`. "Com atribuição" = ao menos um sinal de origem (não conta `sessionId`/`_fbp`).
- `GET /leo/journey-events?from&to&event&limit(≤2000)&after` — eventos de jornada em ordem cronológica. Por evento: `journeyId, sessionId, userId (registrado), identity (anonymous|identified|ambiguous), personId, name, source, medium, campaign, content, term, referrer, linkedFromJourneyId, via, commercialState, subscriptionStatus, commercialBasis`. Allowlist de eventos; **não** expõe interview/perguntas/erros, `fbclid`, `gclid`, `_fbp`, `_fbc`.
  - **22/09: `name` (User.name) adicionado por pedido explícito, confirmado com o treinador — reverte a
    regra original de "só agregado, sem PII" deste endpoint (§CI-002 original: "não precisamos expor
    dados pessoais individualizados"). Só vem preenchido quando `identity==='identified'`; em
    `anonymous`/`ambiguous` fica `null` (nunca um palpite sobre qual pessoa). `fbclid`/`gclid`/`_fbp`/`_fbc`
    continuam nunca expostos — a mudança foi específica para o nome, não uma reversão geral de privacidade.
- `GET /leo/commercial-events?from&to&limit&after&includeBaseline` — `status_changed`/`payment_confirmed` com `value` (só Asaas), `origin`, `isFirstPurchase`, `stateAfter`, `journeyIds`; mais `firstPurchases` (Asaas **e** RevenueCat).
- `GET /leo/landing-summary?from&to` — visitas/jornadas/sessões, por origem+conteúdo, e **coorte** de jornadas novas (1ª `landing_view` de sempre no período) com `landingViewed, ctaClicked, appOpened, signedUp, firstPurchase` (jornadas distintas, vinculadas por `journeyId`). **Nenhuma taxa é calculada.**

## 7. Migração (`20260919120000_billing_history_baseline_and_payment_unique`)

Só dados/índice, sem coluna nova: (1) `baseline_snapshot` por aluno; (2) índice único **parcial** `BillingEvent_payment_confirmed_externalRef_key` (um pagamento confirmado conta uma vez; dedupe defensivo antes). O índice parcial não é expressável no `schema.prisma`: não remover sem migration explícita.

## 8. Limitações reais

- Sem elo determinístico não há vínculo: troca de navegador/dispositivo, modo privado, limpeza de storage, WebView/iOS ITP → nova jornada.
- **Landing → loja → app nativo** (Play Store hoje, App Store depois): `journey_id` na URL não sobrevive à instalação. Exigirá mecanismo próprio (ex.: referrer de instalação do Play / deferred deep link). O modelo de dados (`journeyId` + `journey_linked` no login) já comporta isso; nada foi inventado.
- Links **sem UTM** (busca, direto, compartilhamento) são aceitos: origem = só `referrer` real, ou vazia.
- O PWA mantém a atribuição **first-touch** já existente no `app_opened` (não sobrescreve); a origem **por visita** está nos eventos da Landing.
- Endpoints públicos de analytics aceitam `journeyId` do cliente (sem autenticação): o vínculo journeyId↔userId é o único elo autoritativo (JWT).
- **Sem backfill.** `landing_view` histórico nunca foi persistido; o funil interno estava rejeitando 100% dos eventos com HTTP 400 desde 16/09 17:23 (ver §9). Estado comercial anterior ao deploy só é reconstruível com `basis` de menor confiança (`first_paid_bound`, `current_status_unchanged_since`) ou `unknown`. Renovações Asaas anteriores ao deploy não têm `payment_confirmed`; assinaturas RevenueCat anteriores não têm `firstPaidAt`.
- `payment_confirmed` do sync diário só é gravado quando o sync detecta a ativação (não reconstrói pagamentos antigos perdidos).

## 9. Incidente: commit `617788a` ("f", 16/09 17:23)

Uma sincronização da pasta de trabalho sobrescreveu o espelho e apagou trabalho já entregue por outra linha (commits `9335b27`…`3e24316`, 14–16/09): rota `/links`, validação do DTO do funil (`journeyId`/`dedupeKey`), coorte do funil, GA4/Clarity/Meta na Landing e no PWA. Consequência medida: o DTO em produção **rejeitava todos os eventos** do funil (`property … should not exist`). Restaurado nesta entrega: `/links`, DTO validado com `journeyId`/`dedupeKey`. **Não** restaurado (decisão de escopo, a confirmar com Elton): GA4, Clarity, Meta Pixel/CAPI da segunda implementação, eventos de ativação (`quick_intake_*`, `subscription_*`, `checkout_*`, `training_generation_*`, `first_workout_*`) e cobertura de cohort no painel admin. Causa raiz: duas linhas de trabalho editaram os **mesmos arquivos** em pastas diferentes (pasta de trabalho × repositório/espelho) e o `.bat` copia a pasta de trabalho **por cima** do espelho sem checar se o espelho tem commits que ela não tem. Mitigação nesta entrega: a pasta de trabalho foi reconciliada (agora contém os arquivos recuperados) e o `.bat` ganhou um aviso e passou a listar os arquivos de landing/jornada/testes. **Regra:** antes de sincronizar, conferir `git log origin/main` no espelho e comparar as árvores (`git diff` do espelho contra a pasta de trabalho) — commits feitos direto no espelho são sobrescritos silenciosamente.
