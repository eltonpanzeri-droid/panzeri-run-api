# Plano técnico — Zepp/Amazfit + Atlas (revisão de 20/10/2026)

> Status: **proposta para revisão de Elton. Nada deste plano além do Lote 1 foi implementado.** Sem commit, push, deploy ou alteração em produção sem autorização.
> Substitui a sequência de lotes do diário de 19/10/2026. O Lote 1 (elegibilidade de IA + consentimento 1.1) segue válido e já está commitado por Elton.

## 1. O que mudou com a resposta oficial da Zepp (Jeff Fu, 20/10/2026)

| # | Confirmação | Efeito no plano |
|---|---|---|
| 1 | Dado Zepp autorizado pode ser processado por Anthropic ou outro fornecedor de IA; **sem aprovação adicional da Zepp**. | Sai da lista de bloqueios: "regularização com a Zepp". **Continuam** as obrigações do Panzeri Run (abaixo, seção 4). |
| 2 | Publicar treino estruturado pela Workout API V2 (`POST /users/-/workouts?version=2.0.0`), com sincronização para Amazfit e execução guiada, janela de 7 dias. Sem aprovação separada. | **Entra na primeira entrega** (Lote 2), não é melhoria futura. |
| 3 | FIT: FC, cadência, elevação, potência, GPS e informações básicas podem ser processados, se disponíveis e cobertos pela autorização do aluno. | Resolve o item "campos autorizados" (pedir a frase por escrito no mesmo e-mail de confirmação, para o arquivo do projeto). |

A Zepp exige, antes de habilitar a IA: explicar o uso de IA e o processamento externo no **acordo de uso e nas informações de privacidade do Panzeri Run**, e o aluno **concordar expressamente**. Retenção, exclusão, segurança e transferência internacional são responsabilidade do Panzeri Run.

## 2. Ciclo completo e lotes

Prescrever → enviar ao relógio → executar → importar → analisar pelo Atlas → ajustar a próxima prescrição.

| Lote | Conteúdo | Etapa do ciclo | Depende de |
|---|---|---|---|
| **1 (feito)** | Elegibilidade de dados para IA, trava de saída, consentimento 1.1 (IA externa opcional e separada). | base | — |
| **2 — Envio ao relógio** | Adaptador Zepp da Workout API V2 sobre o `CanonicalWorkout` + `WorkoutDelivery` já existentes; nova finalidade de consentimento "enviar treinos ao relógio"; janela móvel de 7 dias. | prescrever → enviar | consentimento 1.2, perguntas à Zepp (seção 3.4) |
| **3 — Receber e importar** | Webhook de eventos de atividade (`text/plain`, idempotência por `summaryId`) → fila → download do FIT com Bearer do aluno (URL de 24 h, uso único) → leitura do FIT (`fit-file-parser` 6.2.2) → só campos autorizados → `ActivityLog` + série temporal (GPS: migration). **FIT original não é guardado.** | executar → importar | Lote 2 não é pré-requisito técnico, mas o ciclo só fecha com os dois |
| **4 — Fechar o ciclo** | Vínculo prescrito × executado para atividade Zepp; entrada no pipeline existente (identidade física, análise de execução); backfill de 30 dias (opcional, só com `history_backfill`). | importar → analisar | Lote 3 |
| **5 — Atlas com dado Zepp real** | Liberação formal do envio externo (seção 4). Sono (Sleep Events) pode vir depois. | analisar → ajustar | consentimento ativo + avisos publicados + requisitos LGPD |

A "primeira entrega funcional" = Lotes 2 + 3 + 4 juntos (ciclo fechado com dado local). O envio de dado Zepp real à Anthropic (Lote 5) é a única parte que fica bloqueada por requisitos externos ao código.

## 3. Lote 2 — Publicar treinos estruturados no relógio

### 3.1 Princípio
O adaptador **só traduz** a estrutura que a IA/treinador já decidiu (Princípio da prescrição do CLAUDE.md). Nenhuma fórmula escolhe treino, ritmo ou carga. Perda de representação nunca é silenciosa: o treino **não é enviado** e o motivo é registrado (`losses`), como já faz o adaptador Apple.

### 3.2 Reaproveitamento (nada novo na base)
- `training-plans/canonical-workout.ts`: representação canônica (passos, repetição, pace com faixa prescrita × tolerância derivada, `losses`/`warnings`).
- `workout-delivery/` (`WorkoutDelivery`: pending → sent → delivered_to_device/failed/canceled; cada tentativa é linha nova). Para Zepp só existirá `sent` (a API devolve `code:1` de sucesso, **não** confirma recebimento no relógio) — `delivered_to_device` não será marcado por suposição.
- `apple-workout-eligibility.ts` como modelo: só corrida (contínua e intervalada) na 1ª versão; musculação, fortalecimento e demais modalidades registram `not_supported` (não enviar).

### 3.3 Mapeamento canônico → Workout V2 (esquema oficial)
| Canônico | V2 | Observação |
|---|---|---|
| sessão de corrida | `workout`: `workoutId` (inteiro), `workoutDate`, `sport: "RUNNING"`, `workoutName`, `description`, `steps` | `workoutId` precisa ser **inteiro estável por sessão** → tabela de referência (sequência do banco) |
| passo | `WorkoutStep`: `stepOrder`, `intensity` (WARMUP/INTERVAL/RECOVERY/COOLDOWN/ACTIVE/REST), `durationType` TIME/DISTANCE, `durationValue`, `targetType` (PACE_LAP/HEART_RATE_LAP/…), `targetValueLow/High` | só os valores de `intensity` documentados; papel `unspecified` → `ACTIVE` com aviso, nunca inventar |
| repetição | `WorkoutRepeatStep` com `repeatType: REPEAT_UNTIL_STEPS_CMPLT`, `repeatValue`, `steps` | ordem própria em cada nível |
| pace prescrito | `PACE_LAP` com faixa baixa/alta | **unidade não documentada** (ver 3.4); a tolerância ±20 s do gerador é derivada e **não** vira meta |
| caminhada | passo com `activity=walk` explícito | sem equivalente documentado → tratar como `losses` até a Zepp responder |

Texto enviado à Zepp (`workoutName`/`description`): só o necessário para a execução (título e orientações técnicas do treino). **Nunca** nome do aluno, dado de saúde, dor, feedback ou texto do Relator. Revisar o texto de `notes` da IA contra isto antes de enviar.

### 3.4 Perguntas à Zepp (Workout V2 — a página não especifica)
1. Unidade de `PACE_LAP` (s/km? m/s? min/km?) e de `targetValue*` para FC (bpm) e potência (W).
2. Unidade de `durationValue` quando `durationType = DISTANCE` (metros?).
3. Lista completa de valores de `intensity`, `targetType`, `secondaryTargetType`, `repeatType` e `sport`.
4. Limites: passos, profundidade de aninhamento, repetições, tamanho de `workoutName` e `description`.
5. `workoutDate` aceita só data ou data-hora? Fuso aplicado?
6. **A atividade executada (webhook/FIT) traz o `workoutId` publicado?** Se sim, o vínculo prescrito × executado fica exato (hoje é inferido por data/modalidade/distância).
7. Rotina diária: a página diz que a janela dos 7 dias seguintes sincroniza todo dia — o Panzeri Run precisa reenviar a janela diariamente, ou a Zepp só reenvia ao relógio o que já recebeu?
8. Treino já executado dentro da janela e reenviado: é removido, mantido ou duplicado?

### 3.5 Janela móvel de 7 dias (regras da API)
- Corpo: `startDate`, `endDate` (**exatamente 6 dias depois**), `workouts[]`; cada treino dentro da janela.
- **Toda atualização reenvia a janela inteira** (mesmo mudando um treino). Dia sem treino = omitido.
- `workouts: []` **apaga** tudo de "agora" até +7 dias no servidor da Zepp (ignora as datas do cliente).
- Revogação do aluno: o endpoint de revogação já remove os treinos; **não** enviar `workouts: []` junto.
- Design: `ZeppWorkoutPublisher.publishWindow(userId)` calcula o conjunto atual (sessões prescritas de corrida dos próximos 7 dias do programa ativo, já filtradas por elegibilidade), monta o corpo e envia **sob trava por aluno** (uma publicação por vez; concorrência = última vence, sempre com o estado atual do banco). Idempotente: reenviar a mesma janela não muda nada. Gatilhos: geração/regeneração da semana, edição de treino pelo treinador, troca de rotina e rotina diária (cron com trava, como os demais). Falha → nova tentativa com espera crescente; nunca bloqueia geração do treino.
- Reenvio **nunca** envia `[]` por acidente: lista vazia só é enviada por ação explícita ("retirar treinos do relógio") e registrada.

### 3.6 Consentimento 1.2 (muda o hash → reconsentimento)
- Nova finalidade **opcional e separada** `watch_delivery` ("Enviar meus treinos ao relógio"), revogável sem reconectar; sem ela, nenhuma publicação.
- Texto: o que é enviado (treinos prescritos, sem dados pessoais), que a Zepp os guarda/sincroniza, como retirar (desligar ou revogar remove da Zepp).
- Mesma regra de verificação em cada uso (`getAccessToken(provider, userId, categoria)` + finalidade), como o resto da Central.
- Conexões já feitas com 1.1 precisam aceitar 1.2 para habilitar o envio (conexão e importação continuam valendo).

### 3.7 Testes e critérios de aceitação do Lote 2
Estrutural (adaptador só importa o canônico; nenhuma fórmula de treino); traduções (contínua, intervalada com repetição, aquecimento/desaquecimento, passo desconhecido ⇒ `losses` e não envia); janela (end = start+6, treinos fora da janela excluídos, reenvio completo, lista vazia só explícita); concorrência (duas publicações simultâneas); revogação (não envia `[]`); consentimento (sem `watch_delivery` ⇒ negado, texto antigo ⇒ 409); falha de rede/401 (renovação de token, `failed` com motivo); teste com **servidor Zepp simulado** primeiro; só depois um teste real com conta Amazfit de Elton.

## 4. Condições para liberar o envio de dados Zepp reais à Anthropic (Lote 5)

O bloqueio **permanece** (constante `EXTERNAL_AI_APPROVED_PROVIDERS` vazia + variável por provedor). Sai apenas "aprovação da Zepp". Para liberar, todos precisam estar atendidos e registrados:

1. **Consentimento implementado e em produção:** migrations aplicadas (`…230000_consent_enforcement`, `…240000_ai_governance` e a do 1.2), texto 1.1/1.2 publicado, aceite expresso e revogação funcionando — ✔ código do Lote 1; falta aplicar migrations e validar com conexão real.
2. **Avisos de privacidade e acordo de uso atualizados** (exigência da Zepp): fornecedor de IA nomeado (Anthropic — já consta no consentimento 1.1 e no texto legal geral do app), finalidades, que dados Zepp podem ir a fornecedor externo, direito de retirar. **Pendente de revisão jurídica.**
3. **LGPD — itens do Panzeri Run:** base legal e consentimento específico para dado de saúde/sensível; **transferência internacional** (Anthropic fora do Brasil: mecanismo do art. 33); termos de processamento/retenção com a Anthropic (retenção zero ou mínima, sem treinamento com os dados); retenção e exclusão do dado Zepp no Panzeri Run; incidente/contato do titular.
4. **Revogação efetiva:** retirar `ai_external` (ou desconectar) precisa **invalidar artefatos derivados** (relatório de evolução, resumo do prontuário, instantâneos do Analista, pacotes de evidência) — hoje não reprocessa; é pré-condição.
5. **Prova técnica:** teste de ponta a ponta em ambiente de teste, com dado sintético, comprovando que (a) sem `ai_external` nada sai, (b) campo GPS/sensor não autorizado nunca chega ao contexto da IA, (c) revogação no meio da geração é barrada (já testado por unidade).
6. Elton autoriza por escrito; só então: mudança de código revisada (constante) + variável no EasyPanel.

> Observação: o aceite do aluno é para **dado Zepp**. Provedores legados (Polar, Wahoo, Strava, Apple Health, Health Connect) seguem como antes; o achado "legados sem consentimento de IA por provedor" continua para a revisão jurídica.

## 5. Lote 3 — Importar (resumo do que já está decidido)
- Webhook `text/plain` com array JSON de strings; sem HMAC/allowlist → defesa em profundidade: URL com segredo longo e rotacionável, validação estrita, `summaryId` como chave idempotente, fila existente (`ProviderInboundEvent`), tamanho máximo, limite de taxa, descarte de payload ao concluir.
- Download do FIT com Bearer do aluno (URL 24 h, uso único), em memória, sem gravar o arquivo; leitura estrita com CRC; **filtro por campo conforme o consentimento** (GPS só com "Percursos e GPS"; sensores só com `activity_sensors`); o que não está autorizado é descartado antes de gravar.
- Migration para série temporal com GPS (colunas novas, nulas, sem mexer nas existentes). Entrada no pipeline: `RawExternalActivity → ActivityLog → identidade física → vínculo`.
- Se a Zepp confirmar (pergunta 3.4-6) que a atividade traz o `workoutId`, o vínculo passa a ser exato.

## 6. Riscos e decisões que preciso de Elton

1. **Aprovar a ordem:** Lote 2 (envio) antes do Lote 3 (importar), ou os dois em paralelo? Recomendo 2 → 3 → 4, porque o envio é independente do recebimento e permite testar o ciclo prescrição → relógio cedo.
2. **Autorizar** as perguntas da seção 3.4 serem enviadas à Zepp (open-api-support@zepp.com) — não implemento o mapeamento de pace/distância sem as unidades.
3. **Aprovar o escopo da 1ª versão do envio:** só corrida contínua e intervalada; caminhada e demais modalidades ficam fora até a Zepp responder.
4. **Texto jurídico:** 1.1 e 1.2 e os avisos de privacidade precisam do advogado antes de qualquer aluno real (já registrado em `pending_legal_review`).
5. **Risco operacional:** reenvio diário da janela cria carga de chamadas (1 por aluno conectado por dia + mudanças); cabe com folga, mas respeitar limites que a Zepp informar. Falha na Zepp nunca impede gerar/mostrar o treino ao aluno.
6. **Risco de produto:** o relógio mostra o treino enviado; se o treinador editar depois e a publicação falhar, o relógio fica com versão antiga — o painel precisa exibir o estado da entrega (enviado/falhou/versão) para o treinador.

## 7. Estado atual e próximos passos sugeridos
- **Pronto/commitado:** Lote 1; integrações anteriores; Passos 1, 2 e 2b da Central (migrations de 19/10 já em produção; as de consentimento/governança **precisam ser confirmadas** em produção).
- **Próximo (se aprovado):** (a) enviar as perguntas à Zepp; (b) escrever o consentimento 1.2 e o adaptador do Lote 2 com servidor Zepp simulado, em lotes pequenos e revisáveis; (c) atualizar os textos legais para revisão do advogado.

## 8. Status de implementação (atualizado em 20/10/2026, fim do dia)
Lotes 2, 3 e 4 **implementados e testados localmente** (sem commit, sem migrations em produção, tudo desligado por padrão). Detalhes e como ligar: `PRONTUARIO.md`, entrada "Zepp/Amazfit Lotes 2, 3 e 4 + Atlas". O que ainda depende da Zepp: unidades e enums da Workout V2 (perfil em `apps/api/src/zepp/zepp-workout-profile.ts`, hoje vazio ⇒ nenhum treino é enviado), campo que devolve o `workoutId` na atividade (`ZEPP_EXECUTED_WORKOUT_ID_FIELD`), convenção da cadência no FIT (`ZEPP_FIT_PROFILE`). Lote 5 (sono/recuperação) e a liberação do envio de dado Zepp real à Anthropic seguem pendentes (seção 4).
