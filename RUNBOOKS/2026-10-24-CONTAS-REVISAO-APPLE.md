# Contas de demonstração para a revisão da App Store (24/10/2026)

Status: `active` (código pronto e validado em banco local de teste; **nada executado em produção**).
Gatilho de revisão: nova rejeição, mudança no fluxo de assinatura ou 14 dias sem uso.

## 1. Diagnóstico (build 13, rejeição de 24/10/2026, iPad Air 11" M3)

| Tipo | Afirmação |
|---|---|
| FATO | A Apple exigiu (2.1(a)) contas com conteúdo preenchido e (2.1) uma conta com assinatura expirada; vídeo não substitui acesso funcional. |
| FATO | O app iOS só aceita papel `student` (`App.tsx`: "Este acesso é do treinador. Use o painel web."). Treinador/admin são web e **não** fazem parte do app em revisão: não precisam de credencial. |
| FATO | A única conta de revisão era o aluno "Testando", com histórico real na Apple/RevenueCat. Esse estado oscilava (Sandbox renova por dia; RevenueCat "Transfer to new App User ID"; chave `.p8` em várias linhas) e uma conta expirada **não mostra conteúdo** (programa travado). Uma conta só não consegue provar "conteúdo preenchido" **e** "expirada" ao mesmo tempo. |
| INFERÊNCIA | A Apple abriu a conta e viu, ou "Ativa" (voltou sozinha) ou "expirada" sem conteúdo para explorar. Não temos a captura da tela do revisor: DESCONHECIDO qual das duas. |
| FATO | A build 13 é o commit `ccccaef`. O HEAD tem muito mais coisa (Health Connect, Zepp, Observatório...) que **não** estão na build 13. O que a Apple vê depende só do servidor + dados, não de uma build nova. |

**Correção:** duas contas sintéticas com estados determinísticos, criadas por um comando controlado — nenhuma mudança no app iOS, nenhuma nova build.

## 2. Contas

| Conta | Para quê | Estado no banco | O que o revisor vê |
|---|---|---|---|
| **A — ativa** | Provar todas as funcionalidades com conteúdo | `manual_active`, provedor `revenuecat`, override manual | Início com treino de hoje, semana, gráfico de evolução, feedbacks (sono/prontidão/esforço), conquistas, prova alvo; Treinos (4 sessões: fortalecimento, contínua, intervalada, longão); histórico de 4 semanas; Equipamentos (1 tênis); Ciclo menstrual (conta feminina); Conta → "Ativa" + **"Gerenciar assinatura na loja"**; no iOS nativo ainda "Ver planos e preços" (build 13) |
| **B — expirada** | Provar o fluxo de compra | `canceled`, provedor `revenuecat`, sem nenhum registro de loja | "Assinatura expirada"; programa travado; no iOS nativo a tela de assinatura da loja (preço do produto `panzeri_run_mensal`, renovação automática, Termos, Privacidade, Restaurar compras); compra pelo Sandbox |

Por que B é determinística: o estado "expirada" vem do nosso banco e **não depende da Apple**. Como B nunca teve compra, não há o que o RevenueCat/Apple "reativem". Só uma compra feita pelo revisor no Sandbox a ativa (comportamento correto); a expiração do Sandbox (ou `seed --yes --reset-access`) devolve B ao estado expirado.

Por que A usa provedor `revenuecat` + override: o app mostra "Gerenciar assinatura na loja" (e o servidor recusa cancelar por outra via), e nenhuma reconciliação (leitura, rotina de 6 h, webhook) pode revogar o acesso (`subscriptionManualOverride`). Com provedor `asaas`, o botão "Cancelar assinatura" desativaria a conta de demonstração.

## 3. Como criar/restaurar (Elton, EasyPanel → API → Console)

As senhas **nunca** vão para arquivo, commit ou chat. Digite-as direto no console; o e-mail precisa começar com `revisao-apple-`.

```bash
export REVIEW_ACTIVE_EMAIL='revisao-apple-ativa@example.com'
export REVIEW_EXPIRED_EMAIL='revisao-apple-expirada@example.com'
export REVIEW_ACTIVE_PASSWORD='<senha forte 1, mín. 12 caracteres>'
export REVIEW_EXPIRED_PASSWORD='<senha forte 2, mín. 12 caracteres>'
node dist/app-review/cli.js status
node dist/app-review/cli.js check-store
node dist/app-review/cli.js seed --yes
```

- `status` só lê. `seed --yes` cria as contas; se já existirem, restaura **só o conteúdo** e **preserva assinatura/acesso** (uma compra Sandbox legítima não é revertida). `--reset-access` (opcional, deliberado) devolve A a ativa e B a expirada. Id derivado do e-mail; se o e-mail for de outra conta, aborta sem alterar nada. Conta excluída pelo revisor (e-mail anonimizado) é recriada com o mesmo id.
- `check-store` só lê e **nunca imprime valores**: diz se `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET` e `APPLE_IAP_*` existem, se a chave `.p8` é utilizável e se o RevenueCat aceita a chave secreta (HTTP 200).
- Não toca em nenhum outro aluno, não chama IA, Asaas nem Apple, não escreve no RevenueCat e não faz cobrança.
- **Sem ação semanal:** a API renova sozinha o programa das contas de revisão todo dia às 4h (e 45 s depois de subir), **somente se a semana virou**; nunca mexe em senha, assinatura, provedor ou override. Só é preciso rodar o seed uma vez. (Se o revisor registrar feedback numa semana, ele some na virada da semana — o conteúdo é reconstruído.)
- **Efeitos colaterais conhecidos:** as duas contas entram nas listas do painel (Alunos) e nos funis como alunos normais; uma compra Sandbox na B pode disparar os avisos normais de pagamento (ex.: Telegram). Não cadastrar esses e-mails em "Testadores" (isso liberaria acesso grátis na B ao iniciar compra).
- A B **volta a expirada sozinha** depois de uma compra de teste: o Sandbox da Apple expira a assinatura em poucos minutos e a reconciliação (leitura, rotina de 6 h, webhook EXPIRATION) revoga porque a B não tem override. Se não voltar, `seed --yes --reset-access`.
- Nas Notas da Apple pedir: **não excluir a conta** (se acontecer, rodar `seed --yes` recria).

## 4. Fundamento do modelo de pagamento (Diretrizes 3.1.1, 3.1.2, 3.1.3)

| Pergunta | Resposta |
|---|---|
| O que se compra? | Assinatura mensal de **programa de treino de corrida personalizado**, entregue e consumido dentro do app (conteúdo/serviço digital). |
| É caso de exceção 3.1.3(d) (serviço pessoa a pessoa)? | **Não.** A prescrição é gerada pelo sistema e consumida de forma assíncrona, sem sessão individual em tempo real. Não usar essa exceção. |
| Onde se contrata no iOS? | **Somente** In-App Purchase (RevenueCat → produto `panzeri_run_mensal`). No iOS nativo, `isNativeStorePurchaseAvailable()` desvia antes de qualquer caminho do Asaas; CPF e cupom ficam ocultos; a fatura do Asaas não é aberta (`iosStoreBuild()`). |
| Quem assinou fora (site/PWA/Asaas)? | Mantém o acesso no app iOS: é o caso de **3.1.3(b), serviço multiplataforma** (permitido desde que o mesmo item exista como IAP no iOS, o que existe). Quando há pendência de fatura do site, o app não leva a pagamento externo: orienta falar com o treinador ou assinar pela App Store. |
| Exigências 3.1.2(a) | Preço, período, renovação automática, cobrança pela conta Apple, Termos, Privacidade, **Restaurar compras** e atalho para gerenciar/cancelar na loja: presentes (builds 10–13). |
| Exclusão de conta (5.1.1(v)) | Presente em Conta → "Excluir minha conta". |
| Conclusão | **Modelo atual compatível** com 3.1.1 + 3.1.3(b). Nenhuma alteração estrutural de cobrança é necessária. |
| Não verificado | (a) o produto `panzeri_run_mensal` em "Pronto para enviar/aprovado" e disponibilidade no App Store Connect; (b) a tela da loja renderizando preço real **num aparelho iOS** (a web não tem a loja); (c) compra Sandbox ponta a ponta na conta B. Ver §7. |

## 5. Texto para "App Review Information" (App Store Connect)

**Sign-in required: Yes.** Campos Username/Password: conta **A** (ativa). A conta **B** vai no campo Notes (a Apple permite credenciais adicionais nas notas). **Preencha as senhas só no App Store Connect.**

```
The app is for students only (the coach/admin tools are a separate web panel and are not part of this app).
We provide TWO demo accounts with synthetic data. No SMS, e-mail code, invitation or approval is needed. Both work on a clean install.

ACCOUNT A - ACTIVE SUBSCRIPTION (Username/Password fields above)
  Shows every feature with content: Home (today's workout, weekly summary, progress chart, feedback indicators, achievements, target race), Workouts tab (this week's program: strength, easy run, intervals, long run; tap a workout to open it; tap "Anterior" for earlier weeks), menu > Evolução, Calendário de treinos, Equipamentos, Prova alvo, Registrar ciclo menstrual, Dispositivos e integrações, Privacidade e dados, Fontes científicas e metodologia.
  Account tab > "Plan and billing": shows "Active", "Manage subscription in the store" and "Ver planos e preços" (shows the App Store subscription offer).

ACCOUNT B - EXPIRED SUBSCRIPTION (use for the purchase flow)
  E-mail: <REVIEW_EXPIRED_EMAIL>      Password: <enter in App Store Connect only>
  Log in: the Workouts tab shows the locked program and the subscription offer; Account > Plan and billing shows "Assinatura expirada".
  Tap the subscribe button to load the App Store product (monthly auto-renewable subscription, price and renewal terms shown before purchase) and complete the purchase with your Sandbox Apple ID. "Restaurar compras" is on the same screen.

PAYMENT MODEL
  Subscriptions on iOS are sold ONLY through In-App Purchase (Guideline 3.1.1). The app has no link, button or text that directs iOS users to an outside payment. Users who subscribed on our website/Android keep access (Guideline 3.1.3(b)); the same subscription is available as IAP.
  Account deletion: Account tab > "Excluir minha conta".
  Please do not delete the demo accounts. External dependencies: our API only (no third-party login).
```

## 6. Resposta à Apple (colar na caixa de resposta)

```
Hello,

Thank you for the feedback. We prepared two dedicated demo accounts and put them in App Review Information:

1) An account with an ACTIVE subscription and pre-filled content (training program, history, feedback, evolution charts, achievements, equipment, target race) so every feature can be reviewed without any action from us.
2) An account whose subscription is EXPIRED, created in a state that does not depend on Sandbox renewal timing. After logging in, the program is locked and the App Store subscription offer is shown; the purchase can be completed with a Sandbox account, and "Restore Purchases" is available.

The iOS app has a single user type (student); the coach tools are a separate web panel outside this app, so no additional credentials are needed. Subscriptions on iOS are sold only through In-App Purchase. Instructions for each account are in the review notes.

Thank you.
```

## 7. Procedimento de teste em aparelho Apple (build 13) — obrigatório antes de responder

Pré-requisitos: iPhone (ou iPad) físico; build 13 instalada pelo **TestFlight**; seed rodado em produção (§3); uma **conta Apple Sandbox** (App Store Connect → Usuários e Acesso → Sandbox → Testadores; e-mail que nunca foi Apple ID real) e, no aparelho, Ajustes → Desenvolvedor → **Conta Apple Sandbox** (ou Ajustes → App Store → Conta Sandbox) com ela. Não usar o Apple ID pessoal.

Uma pessoa com o painel do RevenueCat (Customers) aberto e o console do EasyPanel (logs da API) acompanha cada passo.

| # | Passo no aparelho | Resultado esperado | Onde provar |
|---|---|---|---|
| 1 | Instalação limpa, login na **conta B** | Entra sem pedir código/aprovação | captura |
| 2 | Aba Treinos | Programa **travado** (sem sessões liberadas) | captura |
| 3 | Oferta | Tela da loja: nome, preço **da App Store**, período mensal, renovação automática, Termos, Privacidade, Restaurar compras | captura |
| 4 | Produto | O botão "Assinar" só habilita quando o preço carrega (produto `panzeri_run_mensal` carregado) | captura; se ficar desabilitado: §8 |
| 5 | Assinar → folha de compra "[Ambiente: Sandbox]" → confirmar com a conta Sandbox | Compra concluída | captura da folha |
| 6 | RevenueCat → Customers → ID = id do aluno B | Assinatura `panzeri_run_mensal` **Sandbox**, ativa | captura do RevenueCat |
| 7 | Logs da API / `status` | `POST /billing/store/sync` 200; B com `status: active` | log/saída (sem segredos) |
| 8 | Voltar ao app (abrir Treinos) | Programa **desbloqueado**, sessões visíveis; Conta → "Ativa" + "Gerenciar assinatura na loja" | captura |
| 9 | Aguardar a expiração Sandbox (~30 min no total) e abrir o app | Volta a "Assinatura expirada" (self-healing) | captura; se não voltar: `seed --yes --reset-access` |
| 10 | **Restaurar compras** (tela da loja ou Conta) com a assinatura viva, e depois de reinstalar o app | Acesso recuperado; sem erro | captura |
| 11 | Login na **conta A** → Início, Treinos, menu (Evolução, Equipamentos, Prova alvo, Ciclo), Conta | Conteúdo presente; "Ativa" + "Gerenciar assinatura na loja" + "Ver planos e preços" | capturas |
| 12 | iPad (se disponível) com as duas contas | App roda em modo iPhone sem corte ou travamento | captura |

Ao final: `seed --yes --reset-access` para deixar B expirada antes de reenviar. Se qualquer passo falhar, **não** responder à Apple: anotar o passo e o log.

## 8. Se o produto não carregar (passo 4) — checagens, em ordem

1. App Store Connect → Assinaturas: o produto `panzeri_run_mensal` existe, tem preço, localização e captura de revisão e está em "Pronto para enviar"/"Aprovado" (não "Metadados ausentes").
2. App Store Connect → Acordos, Impostos e Contas bancárias: **Paid Apps Agreement = Ativo**.
3. RevenueCat → Products: `panzeri_run_mensal` (App Store) no app com bundle `com.panzerirun.app`; Offerings → `default` (atual) → pacote `$rc_monthly` → esse produto (já confirmado pela API: §9).
4. A build 13 usa a chave pública `appl_...` embutida (`app.json`); ela pertence ao app Apple do RevenueCat com o mesmo bundle id.

## 9. Checklist de conformidade (estado em 24/10/2026)

VALIDADO = evidência indicada; PENDENTE = procedimento exato; BLOQUEADO = causa. **Nada testado só na web é marcado como validado para iOS.**

### Persistência das contas
| Item | Estado | Evidência / procedimento |
|---|---|---|
| A mantém conteúdo válido por vários dias sem reexecutar o seed | VALIDADO (banco local) | Rotina diária na API (`ReviewAccountsSchedulerService`, 4h e 45 s após subir) reconstrói só o conteúdo quando a semana vira. Teste de integração simula +8 dias: programa na semana nova, senha e assinatura intactas. **Só vale em produção depois do deploy.** |
| Seed não reverte compra Sandbox legítima | VALIDADO (banco local) | Teste: B ativada com assinatura da loja registrada → seed → continua ativa; só `--reset-access` devolve a expirada. |
| B permanece expirada até a compra | VALIDADO (lógica + web) | B sem nenhum registro de loja; a web mostra "Assinatura expirada" e programa travado. Não depende da Apple. |
| B é ativada pelo fluxo normal | PENDENTE (iOS) | Código: compra → `POST /billing/store/sync` → assinatura viva no RevenueCat → B (provedor `revenuecat`, sem override) é recuperada para ativa. Prova real: §7 passos 5–8. |
| B volta a expirada sozinha após o Sandbox expirar | PENDENTE (iOS) | §7 passo 9. |

### RevenueCat / produtos
| Item | Estado | Evidência / procedimento |
|---|---|---|
| Chave pública iOS `appl_...` válida | VALIDADO | A API de offerings do RevenueCat respondeu HTTP 200 com ela. |
| Offering atual / package / produto | VALIDADO | `current_offering_id = default`; package `$rc_monthly` → `platform_product_identifier = panzeri_run_mensal`; igual a `IOS_STORE_PRODUCT_ID` no app. |
| Entitlement | NÃO SE APLICA (verificado no código) | Nem o app nem o servidor leem entitlements: o acesso vem das **assinaturas vivas do cliente** no RevenueCat. Pode existir ou não no painel; não afeta o acesso. |
| Bundle id: app (`com.panzerirun.app`) × RevenueCat × App Store Connect | PENDENTE | Conferir os três painéis (§8 itens 3–4). |
| Sandbox no RevenueCat | PENDENTE | O servidor **não filtra** Sandbox (processa os mesmos eventos). Conferir, no webhook do RevenueCat, que os eventos incluem **Sandbox e Production** e que URL/segredo apontam para a API. Provar com §7 passos 6–7. |
| Credenciais de servidor presentes (sem expor valores) | PENDENTE (após deploy) | `node dist/app-review/cli.js check-store` no console da API: presença de `REVENUECAT_SECRET_API_KEY`, `REVENUECAT_WEBHOOK_SECRET`, `APPLE_IAP_*`, utilidade da chave `.p8` e se o RevenueCat aceita a chave secreta. |
| Painéis RevenueCat / App Store Connect | BLOQUEADO | Não tenho login e não posso digitar credenciais; o navegador embutido cai na tela de login da Apple. Quem confere é Elton (ou me envia capturas). |

### App Store Connect (submissão) — todos BLOQUEADOS para mim (sem acesso) e PENDENTES para Elton
| Item | Procedimento |
|---|---|
| Paid Apps Agreement ativo | Acordos, Impostos e Contas bancárias → Apps pagos = Ativo. |
| Produto de assinatura configurado | Assinaturas → grupo → `panzeri_run_mensal`: preço, localizações, captura de revisão, status "Pronto para enviar". |
| Produto vinculado à submissão | Versão 1.0 → **Compras dentro do app e assinaturas** → adicionar o produto (exigido na 1ª submissão com IAP). |
| Informações de revisão completas | App Review Information: usuário/senha da conta A; Notes com a conta B e as instruções (§5); contato com nome/telefone/e-mail. |
| Duas contas acessíveis | Após deploy + seed + `status`; teste §7 passos 1 e 11. |
| Instruções da conta expirada | Texto pronto em §5 (VALIDADO como texto); colar no App Store Connect (PENDENTE). |

### Outros
| Item | Estado | Evidência / procedimento |
|---|---|---|
| Login A/B, conteúdo, bloqueio, oferta | VALIDADO só na web | Capturas locais; **não vale como prova do iOS**. |
| Tela da loja com preço real, compra, restaurar | PENDENTE (iOS) | §7. |
| Gates | VALIDADO | `tsc` da API sem erros; eslint dos arquivos novos limpo; testes de integração do seeder (ver resultado final no PRONTUARIO). |

## 10. O que falta para responder à Apple com segurança (sem nova build)

1. **Elton**: commit + push + deploy da API (hoje o comando e a rotina diária só existem no código local).
2. **Elton** (console da API): `check-store` → tudo verdadeiro e RevenueCat HTTP 200; depois `status` e `seed --yes`.
3. **Elton** (painéis): conferir §8/§9 (Paid Apps Agreement, produto aprovado e vinculado à versão, bundle ids, webhook Sandbox + Production).
4. **Teste em aparelho com a build 13** (§7), com a conta Sandbox: passos 1–12 OK.
5. `seed --yes --reset-access`, colar notas (§5) e resposta (§6) com as senhas só no App Store Connect, e responder.

Nova build só será necessária se o passo 3 ou 4 revelar defeito **no app** (ex.: o botão de assinar nunca habilita com o produto aprovado). Falhas de configuração (produto, acordo, webhook) se resolvem sem build.
