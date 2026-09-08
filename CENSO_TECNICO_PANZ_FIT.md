# CENSO TÉCNICO — PANZ FIT (Panzeri Run)

**Data da coleta:** 2026-09-08  
**Fonte:** leitura direta de código, schema, git, documentação e comentários inline.  
**Contexto:** sessão com contexto histórico zero — nenhuma conversa anterior disponível.  
**Arquivo:** `/home/user/panzeri-run-api/CENSO_TECNICO_PANZ_FIT.md`

Legenda:
- **IMPLEMENTADO** — existe em código, deployado ou pronto para deploy imediato.
- **PARCIAL** — existe mas incompleto, só num subsistema, ou com ressalvas conhecidas.
- **PLANEJADO/INFERIDO** — documentado como ideia futura; consta em arquivo de projeto mas sem código correspondente.
- **QUEBRADO** — existe em código mas tem falha conhecida, está desativado ou nunca funcionou de verdade.
- **DESCONHECIDO** — mencionado mas sem evidência verificável no repositório desta sessão.

---

## 1. VISÃO GERAL DO PRODUTO

App de assessoria de corrida do treinador Elton Panzeri. O aluno faz uma entrevista inicial; o sistema monta um plano de treino semanal (corrida + força/fortalecimento) via IA; o aluno registra o que fez; o plano é ajustado continuamente. Elton é o único responsável não-técnico — toda mudança passa por sessão de IA.

---

## 2. ARQUITETURA

### 2.1 Monorepo — estrutura

| Camada | Tecnologia | Status |
|---|---|---|
| API (`apps/api`) | NestJS 10 + Prisma 5 + PostgreSQL 17 | **IMPLEMENTADO** |
| Painel admin (`apps/admin`) | Next.js 14, arquivo único `page.tsx` (~2600 linhas) | **IMPLEMENTADO** |
| App do aluno (`apps/mobile`) | Expo SDK 54 / React Native 0.81.5, arquivo único `App.tsx` (~9126 linhas) | **IMPLEMENTADO** |
| Shared packages | `packages/shared` (diretório existe, sem evidência de conteúdo substancial) | **DESCONHECIDO** |

### 2.2 Infraestrutura de deploy

| Item | Status | Detalhe |
|---|---|---|
| API em produção | **IMPLEMENTADO** | EasyPanel, auto-deploy a cada push para `main`. URL: `https://agenteselton-panzeri-run-api.hbljgk.easypanel.host` |
| PWA do aluno em produção | **IMPLEMENTADO** | Domínio bonito: `https://panzerirun.eltonpanzeripersonal.com.br`. Roda como PWA (nginx serving build Expo web). Dockerfile próprio em `apps/mobile/Dockerfile` |
| Landing page pública | **IMPLEMENTADO** | Raiz da API serve HTML estático da landing em `apps/api/src/landing-page.ts` |
| PostgreSQL | **IMPLEMENTADO** | PostgreSQL 17 no EasyPanel. `pg_dump` versão 17 instalada no Dockerfile da API |
| Docker Compose (local) | **IMPLEMENTADO** | `docker-compose.yml` com postgres:17-alpine + api |
| Build Android nativo (EAS) | **PARCIAL** | Build de teste enviado ao Google (03/09). Teste fechado, aguardando 12 testadores por 14 dias para Produção. Não lançado na Play Store pública |
| Build iOS nativo (EAS) | **PLANEJADO/INFERIDO** | `eas.json` existe com perfil `production` para iOS. Produto RevenueCat iOS não importado. Aguardando retomada |
| Workflow git | **QUEBRADO** | Dois diretórios no computador do Elton: diretório de edição (onde a IA age) ≠ diretório do GitHub Desktop. A IA precisa copiar arquivos manualmente após cada edição. Registrado em `PRONTUARIO.md` como pendência |

---

## 3. BANCO DE DADOS (Prisma + PostgreSQL)

### 3.1 Modelos implementados (51 migrations)

| Modelo | Propósito | Status |
|---|---|---|
| `User` | Aluno/treinador. Campos: perfil, auth, assinatura, push token, controle de tentativas de geração, studentCode (sequencial) | **IMPLEMENTADO** |
| `BillingProviderConfig` | Config de plano por provedor (Asaas / RevenueCat) | **IMPLEMENTADO** |
| `BillingSubscription` | Assinatura do aluno. Campos: `provider`, `overdueInvoiceUrl` (adicionado 05/09), `providerStatus`, `externalSubscriptionId` | **IMPLEMENTADO** |
| `OnboardingInterview` | Entrevista inicial. Campos JSON livres + `quickIntakeCompletedAt` (marco das 5 perguntas rápidas pré-pagamento) | **IMPLEMENTADO** |
| `Reassessment` | Reavaliação periódica. Campos: `answers`, `evolutionSummary`, `evolutionWins/Concerns` | **IMPLEMENTADO** |
| `StudentDirective` | Diretrizes do Gerente Técnico. Com `expiresAt` e notificador de vencimento | **IMPLEMENTADO** |
| `StudentObservation` | Observações livres do aluno | **IMPLEMENTADO** |
| `CoachChatMessage` | Histórico de chat do Gerente Técnico (treinador ↔ IA) | **IMPLEMENTADO** |
| `PasswordResetToken` | Reset de senha (hash, expira, uso único) | **IMPLEMENTADO** |
| `LoginLinkToken` | "Link mágico" dos e-mails de aquecimento de prospecto | **IMPLEMENTADO** |
| `UserNotification` | Notificações in-app. Campos: `action` semântico (nunca URL direta), `externalRef` (deduplicação por evento externo) | **IMPLEMENTADO** |
| `MessageLog` | Log de mensagens enviadas (e-mail, Telegram). Campos: `resendEmailId`, `deliveryStatus` (atualizado por webhook Resend) | **IMPLEMENTADO** |
| `HealthProfile` | Perfil de saúde do aluno (PA, diabetes, cirurgias, sono, estresse) | **IMPLEMENTADO** |
| `UserPreferences` | Modalidades, locais, objetivo, prova-alvo | **IMPLEMENTADO** |
| `WeeklyAvailability` | Rotina semanal real (dias, modalidades, durações). Fonte de verdade para geração de treino | **IMPLEMENTADO** |
| `FitnessTest` | Teste de 3km. Campos: tempo, FC, VO2max estimado, vVO2, pace | **IMPLEMENTADO** |
| `TrainingPlan` | Plano de treino. Campos: `planCode` (sequencial), `inputSnapshot`, `generatedBy`, `aiRecommendation` | **IMPLEMENTADO** |
| `TrainingExecutionInsight` | Cache de análise de execução por plano (summary + items em JSON) | **IMPLEMENTADO** |
| `TrainingSession` | Sessão individual de treino. Campos: modalidade, estrutura JSON, `routineMismatchNote` | **IMPLEMENTADO** |
| `WorkoutCompletion` | Registro de treino realizado. 4 dimensões de satisfação (elaboração, execução, capacidade, carga) | **IMPLEMENTADO** |
| `TargetRace` | Prova-alvo. Inclui 10 campos de questionário de contexto motivacional/intenção (escala 1-10) | **IMPLEMENTADO** |
| `PainReport` | Relato de dor. Campos: regiões, intensidade, padrão de surgimento, tendência de piora, impacto no dia a dia | **IMPLEMENTADO** |
| `WeeklyCheckIn` | Check-in semanal (obrigatório antes de gerar nova semana). 3 perguntas em escala + contadores de sessões | **IMPLEMENTADO** |
| `StravaConnection` | Tokens OAuth do Strava por aluno | **IMPLEMENTADO** |
| `StravaAnalysisCache` | Cache da análise IA do Strava. Inclui `customFrequencyDays` por aluno | **IMPLEMENTADO** |
| `StravaActivity` | Atividades sincronizadas do Strava | **IMPLEMENTADO** |
| `Achievement` / `UserAchievement` | Conquistas (tabelas existem, lógica de negócio não verificada) | **DESCONHECIDO** |
| `Challenge` / `ChallengeProgress` | Desafios (tabelas existem, lógica de negócio não verificada) | **DESCONHECIDO** |
| `FreeTesterEmail` | Lista de e-mails de testadores gratuitos (gerenciada pelo admin, sem deploy) | **IMPLEMENTADO** |
| `Coupon` / `CouponRedemption` | Cupons de desconto (até 100%). Gerenciados pelo painel admin | **IMPLEMENTADO** |
| `CoachReport` | Relatórios gerados pelo painel (técnico e de evolução) | **IMPLEMENTADO** |
| `StudentProfileEvent` | Eventos brutos do prontuário (zero custo de IA). Marcados com `summarizedAt` | **IMPLEMENTADO** |
| `StudentProfile` | Resumo condensado do prontuário (atualizado por agente de condensação) | **IMPLEMENTADO** |
| `FunnelEvent` | Rastreamento de funil de onboarding. Inclui `sessionId` anônimo pré-cadastro | **IMPLEMENTADO** |

---

## 4. API (NestJS)

### 4.1 Módulos e rotas principais

#### Auth (`/auth/*`, `/me`, `/reset-password`, `/termos-de-uso`, `/politica-privacidade`)
- Register, Login, Refresh token, Forgot/Reset password — **IMPLEMENTADO**
- "Link mágico" para e-mails de aquecimento (`/auth/login-link/exchange`) — **IMPLEMENTADO**
- JWT com access + refresh tokens, bcrypt para senhas — **IMPLEMENTADO**
- Rate limiting por rota (ThrottlerModule global, 120 req/min padrão) — **IMPLEMENTADO**
- Página HTML de criação de senha (servida pela API, sem framework frontend) — **IMPLEMENTADO**
- Páginas legais públicas HTML (Termos de Uso, Política de Privacidade) em dois endpoints duplicados: `/termos-de-uso` + `/politica-privacidade` (AuthController) e `/legal/terms` + `/legal/privacy` (AppController) — **PARCIAL** (duplicação, sem revisão jurídica formal)

#### Me (`/me/*`)
- `PUT /me/profile`, `/me/health`, `/me/preferences`, `/me/availability`, `/me/anamnese` — **IMPLEMENTADO**
- `GET /me/onboarding`, `PUT /me/onboarding/answer`, `POST /me/onboarding/complete-quick-intake`, `/me/onboarding/complete`, `/me/onboarding/reopen`, `/me/onboarding/complete-routine` — **IMPLEMENTADO**

#### Training Plans (`/training-plans/*`)
- `POST /training-plans/week` (geração manual com disponibilidade) — **IMPLEMENTADO**
- `GET /training-plans/current` (só leitura, nunca gera) — **IMPLEMENTADO**
- `POST /training-plans/generate-current-week` (botão do aluno, com controle de tentativas) — **IMPLEMENTADO**
- `GET /training-plans/weekly-checkin/status` — **IMPLEMENTADO**
- `POST /training-plans/weekly-checkin` — **IMPLEMENTADO**
- `POST /training-plans/weekly-checkin/skip` (sentinela `elaborationSatisfaction=0`) — **IMPLEMENTADO**
- `GET /training-plans/week-by-offset` — **IMPLEMENTADO**
- `PATCH /training-plans/sessions/:sessionId/reschedule` — **IMPLEMENTADO**

#### Workout Completions (`/workout-completions`)
- Registro de treino realizado, com 4 dimensões de satisfação e feedback por exercício — **IMPLEMENTADO**

#### Coach (`/coach/*`) — restrito a role `coach`/`admin`
- Dashboard com paginação e busca — **IMPLEMENTADO**
- CRUD de alunos (criar, editar, senha, merge) — **IMPLEMENTADO**
- Geração/regeneração de semana, sessão manual, reagendamento, remoção — **IMPLEMENTADO**
- Gerenciamento de disponibilidade do aluno — **IMPLEMENTADO**
- Billing: link de checkout, refresh de status, histórico de faturas — **IMPLEMENTADO**
- Análise do Strava por aluno (manual) — **IMPLEMENTADO**
- Cupons: criar e atualizar — **IMPLEMENTADO**
- Backup manual do banco — **IMPLEMENTADO**
- Prospectos e ex-alunos — **IMPLEMENTADO**
- Funil de cadastro — **IMPLEMENTADO**
- Testadores gratuitos: listar, adicionar, remover — **IMPLEMENTADO**
- Observações: arquivar — **IMPLEMENTADO**
- Mensagem direta para aluno (e-mail/Telegram) — **IMPLEMENTADO**
- Relatórios `technical` e `evolution` (gerados por código, sem IA adicional) — **IMPLEMENTADO**
- Reabrir entrevista — **IMPLEMENTADO**
- Liberar tentativa extra de geração — **IMPLEMENTADO**

#### Coach Tooling (`/coach-tools/*`) — acesso por chave fixa `CLAUDE_TOOLING_API_KEY`
- Dashboard, prospects, ex-students, message log, billing history — **IMPLEMENTADO** (só leitura, rotas GET)

#### Technical Manager (`/coach/students/:id/technical-manager/*`) — role `coach`/`admin`
- Chat com agente IA (Claude) sobre aluno específico — **IMPLEMENTADO**
- Listar e desativar diretrizes — **IMPLEMENTADO**
- Tool use: IA pode criar/consolidar diretrizes, ajustar análise do Strava — **IMPLEMENTADO**

#### Billing (`/billing/*`)
- `GET /billing/me`, `GET /billing/history`, `POST /billing/checkout`, `POST /billing/cancel`, `POST /billing/coupon` — **IMPLEMENTADO**
- Webhook Asaas (`/billing/asaas/webhook`) — **IMPLEMENTADO**
- Webhook RevenueCat (`/billing/revenuecat/webhook`) — **IMPLEMENTADO**

#### Strava (`/strava/*`)
- Conectar (URL OAuth), callback (troca de code), status, sync manual, report — **IMPLEMENTADO**
- Webhook de atividade (verificação + recebimento) — **IMPLEMENTADO**
- **Limite de 10 atletas** na API do Strava (pedido de expansão reprovado em 06/09) — **QUEBRADO** para scale

#### Notifications (`/notifications`)
- Listar notificações do aluno, marcar como lida — **IMPLEMENTADO**
- Push notification via Expo Push API (sem SDK adicional) — **IMPLEMENTADO**

#### Reassessment (`/reassessment`)
- Salvar resposta, completar, relatório de evolução por agente IA — **IMPLEMENTADO**

#### Pain Reports (`/pain-reports`)
- Criar relato de dor; gatilha alerta no Telegram para dores graves — **IMPLEMENTADO** (limitado a 1 alerta a cada 12h por aluno)

#### Target Races (`/target-races`)
- CRUD de provas-alvo com questionário de intenção — **IMPLEMENTADO**

#### Observations (`/observations`)
- Criar e listar observações do aluno — **IMPLEMENTADO**

#### Fitness Tests (`/fitness-tests`)
- Criar teste de 3km — **IMPLEMENTADO** (UI desativada no app do aluno desde 2026-07-28)

#### Messaging (`/messaging/resend/webhook`)
- Webhook de entrega do Resend (HMAC-SHA256 Svix). Atualiza `deliveryStatus` no `MessageLog` — **IMPLEMENTADO**

#### Funnel (`/analytics/event`, `/analytics/funnel`)
- Registro de evento de funil (público, throttled) — **IMPLEMENTADO**
- Relatório de funil (privado, só treinador) — **IMPLEMENTADO**

#### Backup (`POST /coach/backup/run`)
- `pg_dump` → e-mail (Resend) + alerta Telegram em falha ou tamanho excessivo — **IMPLEMENTADO**
- Cron diário às 07h UTC — **IMPLEMENTADO**
- Limite de 20MB como alerta de tamanho — **IMPLEMENTADO** (ainda envia por e-mail; mudança para nuvem: PLANEJADO)

#### Health (`GET /health`)
- `{ status: "ok", version: "2026.07.03-r7", planEngine: "rules-v6" }` — **IMPLEMENTADO** (versão hardcoded, desatualizada em relação ao código real)

### 4.2 Agendadores (Crons)

| Cron | Horário | Status |
|---|---|---|
| Sincronização de pagamentos (Asaas) | Diariamente às 06h | **IMPLEMENTADO** com trava anti-sobreposição |
| Análise do Strava (cadência mensal por padrão) | Diariamente às 06h UTC | **IMPLEMENTADO** com trava anti-sobreposição |
| Avisos (pagamento pendente, entrevista incompleta, reavaliação vencida) | Diariamente às 09h | **IMPLEMENTADO** |
| Aquecimento de prospectos (nurture de e-mail) | A cada hora | **IMPLEMENTADO** (4 estágios: 8h, 24h, 7d, 30d) |
| Backup do banco | Diariamente às 07h UTC | **IMPLEMENTADO** |
| Notificador de diretrizes vencidas | Diariamente às 08h | **IMPLEMENTADO** |
| Pré-geração automática de semanas para todos | DESATIVADO | **QUEBRADO** (removido por decisão do treinador 2026-08-06) |
| Recovery no boot | DESATIVADO | **QUEBRADO** (causou incidente de loop em 02/08; desativado explicitamente) |

---

## 5. AGENTES DE IA (Claude via Anthropic SDK)

| Agente | Localização | Modelo | Status |
|---|---|---|---|
| Agente de Prescrição | `prescription-agent.service.ts` | Claude (Anthropic SDK, modelo não verificado diretamente) | **IMPLEMENTADO** |
| Gerente Técnico | `technical-manager-agent.service.ts` | Claude | **IMPLEMENTADO** |
| Agente de Evolução (Reavaliação) | `evolution-agent.service.ts` | Claude | **IMPLEMENTADO** |
| Agente de Análise do Strava | `strava-analysis-agent.service.ts` | Claude | **IMPLEMENTADO** |
| Agente de Prontuário (condensação) | `student-profile.service.ts` | Claude | **IMPLEMENTADO** |

### 5.1 Fila de IA
- Máximo de 3 chamadas simultâneas (`MAX_CONCURRENT_AI_CALLS = 3`) — **IMPLEMENTADO**
- Timeout de 10 minutos por chamada — **IMPLEMENTADO**
- Timeout de espera em fila: 2 minutos — **IMPLEMENTADO**
- Limite real da conta Anthropic não verificado no código — **DESCONHECIDO**

### 5.2 Metodologia de prescrição
- Regra central: **toda decisão de treino é feita pela IA** (pace, estrutura, exercícios). Zero fórmula fixa no código desde 2026-07-28 — **IMPLEMENTADO**
- Zod valida schema da resposta (campos, tipos, limites numéricos), não semântica — **IMPLEMENTADO**
- Prompt inclui: prontuário do aluno, histórico de semanas, análise do Strava, diretrizes ativas, provas-alvo, relatos de dor — **IMPLEMENTADO**
- Sessões são sequências de partes (contínua e/ou intervalada), não tipo único por dia — **IMPLEMENTADO**
- Recomendação de pace mínimo de 8:30/km como **sugestão de prompt** (não validação em código) — **IMPLEMENTADO**
- Segunda opinião / validador independente da prescrição — **PLANEJADO/INFERIDO** (documentado em `PROPOSTA_HARNESS_AGENTES.md`, sem código)

### 5.3 Prontuário do aluno
- Eventos brutos por código (zero custo de IA) — **IMPLEMENTADO**
- Resumo condensado (max 6000 chars) atualizado por agente antes de cada geração — **IMPLEMENTADO**
- Versão permanente de fatos históricos — **IMPLEMENTADO**

---

## 6. APP DO ALUNO (Expo/React Native como PWA)

### 6.1 Telas / Abas

| ID da aba | Nome | Status |
|---|---|---|
| `notifications` | Avisos | **IMPLEMENTADO** |
| `week` | Treino da semana | **IMPLEMENTADO** |
| `interview` | Entrevista inicial | **IMPLEMENTADO** |
| `quickIntake` | 5 perguntas rápidas pré-pagamento | **IMPLEMENTADO** |
| `routine` | Rotina de treinos | **IMPLEMENTADO** |
| `reassessment` | Reavaliação periódica | **IMPLEMENTADO** |
| `fixAnswers` | Corrigir respostas anteriores | **IMPLEMENTADO** |
| `targetRace` | Prova-alvo | **IMPLEMENTADO** |
| `painReport` | Relatar dor | **IMPLEMENTADO** |
| `observations` | Relatar observação | **IMPLEMENTADO** |
| `progress` | Evolução | **IMPLEMENTADO** |
| `strava` | Sincronizar com Strava | **IMPLEMENTADO** |
| `billing` | Plano e faturamento | **IMPLEMENTADO** |
| `profile` | Perfil | **IMPLEMENTADO** |
| `test` | Teste de 3km | **QUEBRADO** (tela existe mas convite está oculto no app desde 2026-07-28 por decisão do treinador) |
| `anamnese` | Anamnese | **IMPLEMENTADO** (referenciada no Type Tab, aparece no fluxo de entrevista) |

### 6.2 Fluxo de onboarding do aluno
1. App aberto → rastreia `app_opened` no funil
2. Cadastro (email/senha) → `signup_completed`
3. **5 perguntas rápidas** (quickIntake) → `interview_completed` no funil
4. Assinatura → fluxo Asaas (web/PWA) ou RevenueCat (nativo Android)
5. Entrevista completa (pós-pagamento) → `completedAt`
6. Rotina de treinos → WeeklyAvailability populado
7. Geração da primeira semana de treinos

Status: **PARCIAL** — fluxo completo não testado ponta a ponta com pagamento Asaas real (citado no PRONTUARIO.md como pendência)

### 6.3 Geração de treino (botão do aluno)
- Limite de 2 tentativas base por semana — **IMPLEMENTADO**
- Check-in semanal obrigatório antes de gerar — **IMPLEMENTADO**
- Modal "Incluir hoje?" (segunda a sábado quando a rotina tem treino para hoje) — **IMPLEMENTADO**
- Proteção contra duplo toque — **IMPLEMENTADO**
- Banner de progresso durante geração (`isGeneratingWeek`) — **IMPLEMENTADO**

### 6.4 Registro de treino
- CompletionForm com 4 dimensões de satisfação — **IMPLEMENTADO**
- Feedback por exercício inline (dentro de cada exercício expandido) — **IMPLEMENTADO**
- Estado bloqueado pós-envio com "Alterar feedback" — **IMPLEMENTADO**
- Exibição por modalidade: cards separados por sessão no mesmo dia — **IMPLEMENTADO**

### 6.5 Funcionalidades nativas vs. web
| Feature | Web (PWA) | Android nativo | iOS nativo |
|---|---|---|---|
| Core (treino, entrevista, billing) | **IMPLEMENTADO** | **PARCIAL** (build em teste fechado) | **PLANEJADO** |
| Push notifications (Expo) | Limitado pelo browser | **IMPLEMENTADO** | **DESCONHECIDO** |
| RevenueCat (compra in-app) | Não aplicável (usa Asaas) | **IMPLEMENTADO** (chave Android presente em `app.json`) | **QUEBRADO** (sem chave iOS no projeto) |
| Strava OAuth | **IMPLEMENTADO** (redirect via browser) | **IMPLEMENTADO** | **DESCONHECIDO** |

---

## 7. PAINEL ADMIN (Next.js)

### 7.1 Views implementadas

| View | Conteúdo | Status |
|---|---|---|
| Dashboard | Totais, lista de alunos com status, plano, pagamento, última geração | **IMPLEMENTADO** |
| Alunos | Ficha detalhada: perfil, disponibilidade, entrevista, testes, treinos, pagamento, Gerente Técnico, relatórios | **IMPLEMENTADO** |
| Aba Rotina (no detail de aluno) | RoutineAvailabilityTable + ManualRoutineEditor dedicados | **IMPLEMENTADO** |
| Prospectos | Lista com nível (frio/morno/quente) e ações | **IMPLEMENTADO** |
| Ex-alunos | Lista com status de cancelamento e filtros | **IMPLEMENTADO** |
| Semanas | Planejamento semanal (geração em massa por treinador) | **IMPLEMENTADO** |
| Cupons | CRUD de cupons com ativação/desativação | **IMPLEMENTADO** |
| Financeiro | Resumo financeiro via Asaas | **IMPLEMENTADO** |
| Notificações | Lista de notificações de WorkoutCompletion recentes, com paginação e contador | **IMPLEMENTADO** |
| Funil | Relatório de funil de onboarding (eventos reais, sessions stalled) | **IMPLEMENTADO** |

### 7.2 Operações disponíveis no painel
- Criar aluno manualmente / convidar / resetar senha — **IMPLEMENTADO**
- Regenerar semana de treino / sessão individual / recuperar sessões — **IMPLEMENTADO**
- Adicionar sessão manual / editar / deletar sessão — **IMPLEMENTADO**
- Gerente Técnico (chat IA sobre aluno) + directives — **IMPLEMENTADO**
- Gerar/copiar link de checkout Asaas para aluno — **IMPLEMENTADO**
- Refresh de status de pagamento individual e em massa — **IMPLEMENTADO**
- Análise do Strava manual por aluno — **IMPLEMENTADO**
| Testadores gratuitos: adicionar/remover — **IMPLEMENTADO** |
- Liberar tentativa extra de geração — **IMPLEMENTADO**
- Mesclar dois alunos — **IMPLEMENTADO**
- Reabrir entrevista — **IMPLEMENTADO**
- Relatórios `technical` e `evolution` — **IMPLEMENTADO**

---

## 8. INTEGRAÇÕES EXTERNAS

| Integração | Finalidade | Status |
|---|---|---|
| **Anthropic (Claude)** | Prescrição de treino, Gerente Técnico, evolução, análise Strava, prontuário | **IMPLEMENTADO** (obrigatório; sem fallback desde 2026-07-28) |
| **Asaas** | Pagamento recorrente (boleto/cartão), criação de assinatura, checkout link, webhook de cobrança | **IMPLEMENTADO** |
| **RevenueCat** | Compra in-app (Google Play Billing / Apple IAP). Webhook recebido e processado | **IMPLEMENTADO** (só Android; iOS sem chave) |
| **Strava** | OAuth, sincronização de atividades, webhook de atividade nova | **IMPLEMENTADO** (limitado a 10 atletas; pedido de expansão reprovado 06/09) |
| **Resend** | Envio de e-mails (prospects, convites, backup). Webhook de entrega implementado | **IMPLEMENTADO** |
| **Telegram** | Alertas para o treinador (geração, erros, dor grave, backup, directives vencidas) | **IMPLEMENTADO** |
| **Expo Push API** | Notificações push para alunos | **IMPLEMENTADO** (raw fetch, sem SDK) |
| **WhatsApp (Evolution API)** | Alertas / mensagens via WhatsApp | **PLANEJADO/INFERIDO** (VPS Hostinger com Evolution API configurada mas não conectada ao Panzeri Run — citado no PRONTUARIO.md) |
| **Garmin / Polar / Apple Watch / COROS / Amazfit** | Integração de wearables | **PLANEJADO/INFERIDO** (análise de elegibilidade documentada em `integracoes/`, sem código) |

---

## 9. AUTENTICAÇÃO E SEGURANÇA

| Item | Status |
|---|---|
| JWT access + refresh token (bcrypt hash no banco) | **IMPLEMENTADO** |
| Rate limiting global (120 req/min) + por rota sensível (5-10 req/min) | **IMPLEMENTADO** |
| Webhook Asaas: token de acesso no header | **IMPLEMENTADO** |
| Webhook RevenueCat: HMAC-SHA256 no header Authorization | **IMPLEMENTADO** |
| Webhook Resend: Svix HMAC-SHA256 com janela de 5 minutos | **IMPLEMENTADO** |
| Endpoint Claude Tooling: chave estática (`CLAUDE_TOOLING_API_KEY`) | **IMPLEMENTADO** |
| CORS: `origin: true` (qualquer origem) | **IMPLEMENTADO** (permissivo por decisão — pode ser uma vulnerabilidade em produção dependendo do contexto) |
| Termos de Uso e Política de Privacidade com revisão jurídica | **PLANEJADO** (texto existe, revisão jurídica formal não realizada — citado como pendência) |
| LGPD: coleta de consentimento (termos, privacidade, responsabilidade de exercício) | **IMPLEMENTADO** (campos `acceptedTermsAt`, `acceptedPrivacyAt`, `acceptedExerciseResponsibilityAt` no banco) |
| Exclusão de dados por solicitação | **IMPLEMENTADO** (processo descrito na Política de Privacidade servida pela API) |

---

## 10. TESTES

| Cobertura | Status |
|---|---|
| `auth.service.spec.ts` | **IMPLEMENTADO** (unitário) |
| `availability.rules.spec.ts` | **IMPLEMENTADO** (unitário) |
| `exercise-libraries.spec.ts` | **IMPLEMENTADO** (unitário) |
| `performance-calculations.spec.ts` | **IMPLEMENTADO** (unitário) |
| `training-methodology.spec.ts` | **IMPLEMENTADO** (unitário) |
| Testes de integração / end-to-end | **QUEBRADO** (`echo "Mobile tests pending"`, `echo "Admin tests pending"`) |
| Cobertura de serviços críticos (billing, traning-plans, prescription-agent) | **DESCONHECIDO** (nenhum spec encontrado para esses módulos) |
| Teste ponta a ponta do fluxo completo de onboarding com pagamento real | **QUEBRADO** (explicitamente citado como não realizado no PRONTUARIO.md) |

---

## 11. IDENTIDADE VISUAL

| Item | Status |
|---|---|
| Sistema de marca completo (`identidade-visual-panzeri-run/`) | **IMPLEMENTADO** (entregue por ChatGPT em 29/08/2026) |
| Tokens de design em `apps/mobile/theme/tokens.ts` (`PRColors`, `PRFonts`, `PRRadius`, `PRSpace`) | **IMPLEMENTADO** |
| `BrandMark.tsx` (símbolo SVG da Tríade Adaptativa) | **IMPLEMENTADO** |
| Fontes `BigShouldersDisplay_800ExtraBold` | **IMPLEMENTADO** (carregada no app) |
| Fontes `PublicSans` e `JetBrainsMono` | **PARCIAL** (importadas no `package.json`, carregamento no `useFonts` comentado/pendente — nota no código de App.tsx diz que só entram quando alguma tela realmente usar `PRFonts.bodyRegular/bodyMedium/bodyBold/bodyExtraBold/data`) |
| Migração gradual de StyleSheet (App.tsx) para tokens PRColors/PRFonts | **PARCIAL** (em andamento; abordagem deliberada de migração tela a tela) |
| Identidade visual v2 ("Panz Fit") | **PLANEJADO/INFERIDO** (citada no PRONTUARIO.md como proposta não decidida nem implementada) |

---

## 12. FUNCIONALIDADES EXPLICITAMENTE DESATIVADAS

| Feature | Motivo | Status |
|---|---|---|
| Teste de 3km (botão/convite no app) | Decisão do treinador em 2026-07-28; tela e endpoint continuam existindo | **QUEBRADO** (funciona se chamado diretamente, mas inacessível pela UI) |
| Pré-geração automática de treinos para todos os alunos (cron domingo 19h) | Causava problema real de loop de deploy (02/08); removida por decisão | **QUEBRADO** (método existe sem @Cron) |
| Recovery automático de planos no boot da aplicação | Causava loop de requisições de IA em redeploys (02/08) | **QUEBRADO** (`onApplicationBootstrap()` é no-op) |
| Regra de piso de pace mínimo como validação de código | Removida 02/08 por pedido explícito do treinador; mantida só como sugestão de prompt | **QUEBRADO** (constante existe no código mas nunca usada para validar) |
| Aviso de desvio de rotina exibido na tela do aluno | Removido 09/08 | **QUEBRADO** (campo `routineMismatchNote` existe no banco e é gerado pela IA, mas não exibido no app) |
| Limite de caracteres em campos de texto livre da IA | Removido para evitar rejeição de resposta por textos longos; campos de exibição agora truncados defensivamente | Mudança de arquitetura intencional, não bug |

---

## 13. PENDÊNCIAS DOCUMENTADAS (PRONTUARIO.md)

Registradas explicitamente como não resolvidas:

| Pendência | Criticidade inferida |
|---|---|
| Workflow git (`C:\...\Aplicativo Panzeri Run` ≠ repositório do GitHub Desktop) | Alta (causa bugs de deploy invisíveis) |
| Fluxo completo "5 perguntas → assinatura → entrevista → rotina → geração" nunca testado ponta a ponta com Asaas real | Alta |
| Build EAS Android com RevenueCat Android: testadores aguardando 14 dias para liberar Produção | Alta |
| iOS: RevenueCat não importado, build não iniciado | Alta |
| Compra real em sandbox (Android e iOS) ainda não testada | Alta |
| Ricardo Davino: entrevista e rotina completas, sem assinatura ativa — treinador precisa dar cortesia e gerar treino manualmente | Média (operacional) |
| `.bat` de sincronização com lista de migrations fixa/desatualizada | Média (pode repetir-se a cada migration nova) |
| `MAX_CONCURRENT_AI_CALLS = 3` pode ser baixo demais — limite real da Anthropic não verificado | Média |
| N+1 de consultas no cron diário de avisos | Baixa (impacto real mínimo a 1000 assinantes) |
| Push notification sem envio em lote (Expo aceita lote de 100) | Baixa |
| Termos de Uso / Política de Privacidade sem revisão jurídica profissional | Alta (legal) |
| Strava API limitada a 10 atletas (pedido de expansão reprovado) | Alta (escalabilidade) |
| Backup via e-mail sem migração para armazenamento em nuvem | Média (crescerá com o banco) |
| Duplificação de páginas legais (2 conjuntos de rotas servindo Termos/Privacidade) | Baixa |
| Identidade visual v2 ("Panz Fit") não decidida nem implementada | Baixa |
| Integração WhatsApp (Evolution API instalada mas não conectada) | Média (roadmap) |
| Versão do campo `version` em `/health` hardcoded e desatualizada | Baixa |

---

## 14. INCIDENTES CONHECIDOS (DOSSIES)

| Caso | Resumo | Status |
|---|---|---|
| Silvia Mendes Leal (`erros persistentes/0001_Silvia_Mendes_Leal.md`) | Cobrança indevida + travamento na entrevista (CEP, campos opcionais, limite de string). Múltiplas rodadas de correção | **IMPLEMENTADO** (correções deployadas; dossiê ativo de aprendizado) |
| Ricardo Davino | Cobrado pelo Asaas (mesmo padrão de Silvia). Assinatura cancelada. Correção deployada. Aguarda cortesia manual do treinador | **PARCIAL** (bug corrigido; ação operacional pendente) |
| Eduarda | `computeSummary` confundia `missed` com `null` — gerava "sem registro" para treinos explicitamente não feitos, bloqueando check-in. Corrigido no commit `0becca8` | **IMPLEMENTADO** |
| Luiza | `createManualSession` buscava sessões em todos os planos (incluindo arquivados), rejeitando sessão válida. Corrigido no mesmo commit | **IMPLEMENTADO** |

---

## 15. DOCUMENTAÇÃO EXISTENTE NO REPOSITÓRIO

| Arquivo / Pasta | Conteúdo | Qualidade |
|---|---|---|
| `CLAUDE.md` | Constituição de engenharia — princípios, hierarquia de decisão, Gauntlet Loop, matriz de risco | Alta — documento de trabalho ativo |
| `PRONTUARIO.md` | Diário técnico (~105KB). Estado atual, incidentes, decisões arquiteturais | Alta — mais confiável que qualquer outra fonte |
| `LICOES_COLABORACAO.md` | Erros comportamentais da IA registrados por Elton | Alta |
| `PROPOSTA_HARNESS_AGENTES.md` | Proposta de segunda camada de validação ("Hipótese de Trabalho") | Média — não implementada |
| `DOSSIE_CASO_SILVIA.md` | Histórico completo do caso Silvia | Alta |
| `RUNBOOKS/` | Documentação da arquitetura do prontuário | Alta |
| `ELTON2/` | 3 relatórios de auditoria da sessão local (inventário de permissões, credenciais em settings.local.json, etc.) | Alta — referência a máquina local, não ao ambiente cloud |
| `EASY_PANEL.md` | Instrução de deploy da API | Média |
| `DEPLOY_APP_ALUNO.md` | Instrução de deploy do PWA | Alta (domínios atualizados) |
| `TESTE_COM_ALUNOS.md` | Guia de teste com alunos (parcialmente desatualizado — e-mail "ainda não ligado" contradiz PRONTUARIO que diz que sim) | Média |
| `identidade-visual-panzeri-run/` | Sistema de marca completo | Alta |
| `erros persistentes/` | Dossiê de bugs persistentes (1 caso: Silvia) | Alta |
| `erros persistentes/` vazio para outros casos | — | — |

---

## 16. O QUE NÃO FOI VERIFICADO (DESCONHECIDO)

- Conteúdo real de `packages/shared/` (diretório existe, não inspecionado)
- Lógica de negócio de `Achievement`/`Challenge` (tabelas no banco, sem serviço encontrado)
- Limite real de rate da conta Anthropic em produção
- Estado atual de DNS/SSL de todos os domínios do Elton além dos dois confirmados
- Integrações documentadas em `integracoes/` (Garmin, Polar, etc.) — pasta citada no PRONTUARIO mas não verificada no repositório desta sessão
- Conteúdo de `tmp/` na raiz do repositório
- Conteúdo de `erros persistentes/` além do arquivo `0001_Silvia_Mendes_Leal.md`
- Build atual em produção (commit exato rodando no EasyPanel — este censo lê o código do repositório, não o estado da instância)
- Schema de resposta dos agentes de evolução e prontuário em detalhe completo

---

*Este documento foi produzido exclusivamente a partir de leitura do código, schema Prisma, comentários inline, histórico git e arquivos de documentação do repositório. Nenhuma alteração foi feita.*
