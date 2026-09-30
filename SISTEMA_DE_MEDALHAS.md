# Sistema de Medalhas do Panzeri Run — Especificação Funcional

> Status: **especificação registrada, NÃO implementada**. Nenhuma tabela, migration ou código
> criado nesta etapa. Este documento é a fonte de verdade da definição funcional até a
> implementação começar — qualquer mudança de regra deve ser editada aqui primeiro.
>
> Origem: pedido de Elton em 30/09/2026, consolidando decisões já tomadas sobre o sistema de
> medalhas/conquistas do Panzeri Run.

## Propósito

A medalha representa a trajetória real do aluno e funciona em duas direções:

1. **Aluno**: visualizar progresso, constância, marcos alcançados e conquistas futuras.
2. **Gestão**: permitir relatórios agregados sobre o que os usuários do Panzeri Run estão fazendo
   e conquistando (ver seção 18).

## Regras gerais (valem para todas as famílias)

- Cada medalha tem: `id` estável, nome, categoria, critério, limiar, unidade (quando aplicável),
  grau/dificuldade, data da conquista, valor que gerou a conquista, e evidência/origem do dado.
- A conquista é **determinística**. IA nunca decide se o aluno ganhou medalha.
- Uma medalha conquistada fica registrada no histórico **para sempre**, mesmo que o desempenho
  caia depois.
- **Não premiar respostas subjetivamente "boas"**: sono alto, motivação alta, RPE baixo, ausência
  de dor etc. não geram medalha. Feedback é premiado por ser **preenchido**, independente da
  resposta.
- Sessão extra pode contribuir para distância/volume efetivamente realizado, mas **não** aumenta
  artificialmente a aderência ao prescrito.
- Medalhas de volume/distância alto não são recomendação — uma medalha de 200km/mês pode existir
  no catálogo para todo mundo, mas não deve aparecer como "próximo objetivo" de um aluno cuja
  prescrição está longe desse nível (ver seção 16).

## Regra central: medalhas de realização usam EXECUÇÃO REAL (30/09/2026)

Para **todas** as medalhas de volume, distância, sessões realizadas e marcos esportivos, o
critério é aquilo que o aluno **efetivamente executou**, nunca o que estava prescrito.

- Prescrito 20km, executado 10km → medalha considera 10km.
- Prescrito 10km, executado 15km → medalha considera 15km.
- Prescrito 30km na semana, executado 24km → progresso da medalha semanal = 24km.
- Executou 32km na semana mesmo com prescrição inferior → atingiu o critério objetivo de 30km.

Três famílias de medalha, com fonte de comparação diferente:

1. **Medalhas de realização** (constância, treinos concluídos, volume semanal/mensal, sustentação
   de volume, distância única, acumulado, provas) → usam **o realizado/executado**, sempre.
2. **Medalhas de aderência** → comparam realizado com prescrito pela regra canônica de aderência
   (`realizado ÷ elegível`, ver `GLOSSARIO_METRICAS.md`). Treino extra ou volume excedente **não**
   melhora artificialmente a aderência.
3. **Medalhas de participação/processo** (feedbacks, check-ins, reavaliações) → usam a realização
   efetiva da própria ação (o feedback foi de fato enviado / o check-in foi de fato respondido /
   a reavaliação foi de fato concluída) — prescrição ou disponibilidade da ação não contam.

Medalha responde **"o que esse corredor já fez?"**; aderência responde **"como ele executou aquilo
que foi proposto?"**. As duas nunca se confundem na mesma fórmula.

**Segurança**: alcançar uma medalha por execução acima do prescrito não significa que o sistema
aprovou ou recomendou aquele excesso. O fato histórico é registrado normalmente, mas a medalha não
deve ser usada como estímulo de "próxima conquista" quando incompatível com a prescrição atual do
aluno (ver seção 16, regra de filtragem).

## 1. Constância

Semana válida = pelo menos 1 sessão **efetivamente concluída** naquela semana (não basta existir
registro — tem que ser status `done`/`adjusted`, nunca `missed` nem "sem registro"). Pausa
formalmente planejada pelo treinador não é tratada automaticamente como falha.

Medalhas: 1, 2, 4, 8, 12, 16, 24, 36, 52, 100 semanas (consecutivas a partir da 2ª).
Mostra progresso pro próximo marco (ex: 19/24 semanas).

## 2. Aderência ao plano

Calcular **somente** sobre sessões prescritas elegíveis. Treinos extras não entram aumentando o
percentual.

Medalhas: 1ª semana ≥90%, depois 4, 8, 12, 24, 52 semanas consecutivas ≥90%.
**Semana perfeita**: 100% das sessões prescritas concluídas numa semana com pelo menos 2 sessões
prescritas.

## 3. Treinos concluídos

Acumulativo: 1, 5, 10, 25, 50, 100, 250, 500, 1.000 treinos concluídos.

## 4. Volume semanal de corrida

Primeira semana **encerrada** em que o aluno atingir (em km **efetivamente realizados** em
corrida/esteira, independente do que estava prescrito): 10, 20, 30, 40, 50, 60, 75, 100 km.
Nunca conceder antecipadamente numa semana ainda aberta — progresso pode ser visto durante a
semana, mas a conquista só consolida no fechamento.

## 5. Sustentação de volume semanal

Família própria, distinta da anterior: distingue "uma vez corri 30km numa semana" de "sustento
semanas nesse volume".

Patamares: 20, 30, 40, 50, 75, 100+ km/semana.
Para cada patamar: 2, 4, 6, 8, 10 semanas consecutivas ≥ aquele patamar.
Total: 30 conquistas (6 patamares × 5 durações).

Uma semana de 43km conta simultaneamente para as sequências de 20, 30 e 40km, mas não para 50km.

## 6. Volume mensal de corrida

Mês-calendário completo, km **efetivamente realizados** em corrida/esteira. Medalhas: 25, 50, 75,
100, 125, 150, 175, 200, 250, 300, 400, 500, 750 km/mês. As medalhas muito altas existem no
catálogo mas não são apresentadas automaticamente como objetivo recomendado.

## 7. Distância em uma única corrida

Primeira sessão válida que alcançar (distância **efetivamente realizada** naquela sessão, não a
prescrita): 3, 5, 8, 10, 12, 15, 18, 21,1, 25, 30, 35, 42,195, 50 km.

Nomenclaturas especiais: 21,1km = "Meia distância / Primeira meia"; 42,195km = "Maratona";
≥50km = "Ultramaratona" (para o Panzeri Run, ultra começa em 50km, não logo acima da maratona).

## 8. Quilometragem acumulada

Soma de toda distância **efetivamente realizada** em corrida/esteira, registrada no
acompanhamento. Medalhas: 100, 250, 500, 1.000, 2.500, 5.000, 10.000 km acumulados.

## 9. Feedbacks pós-treino

Premia fornecer informação de forma consistente, nunca o conteúdo. Medalhas: 1, 5, 10, 25, 50,
100, 200, 365 feedbacks concluídos. RPE 10 vale exatamente tanto quanto RPE 3. Relatar dor vale
tanto quanto não relatar — o sistema nunca deve incentivar o aluno a responder o que acha que
queremos ouvir.

## 10. Check-ins semanais

"Check-in" = questionário semanal específico do Panzeri Run (não o feedback pós-treino). Medalhas:
4, 12, 24, 52 check-ins concluídos. Importa responder, não responder "bem".

## 11. Reavaliações

Só reavaliações periódicas legítimas contam. Medalhas: 1ª, 2, 4, 6, 8 reavaliações concluídas. Não
permitir repetição artificial para gerar medalhas.

## 12. Provas e grandes marcos

**Não** criar medalhas por quantidade de provas (nunca "5 provas", "10 provas" — incentivo
contrário à organização do treinamento). Manter só marcos relevantes com registro confiável:
Primeira prova; primeira de 5km; primeira de 10km; primeira de 15km; primeira meia maratona;
primeira maratona; primeira ultramaratona ≥50km.

Agendar uma prova não gera conquista — só conclusão comprovada/registrada. **Ativação adiada**: como
hoje `TargetRace.status='concluida'` é autodeclarado pelo aluno (botão manual, sem verificação
cruzada contra treino/distância real do dia — ver seção de desenho técnico), esta família fica
**documentada no catálogo mas não ativa automaticamente** enquanto essa for a única evidência
disponível.

## 13. Retomada

Episódio de retomada = ≥14 dias sem sessão concluída, seguido de retorno.
Medalhas: "Voltei" (1º treino pós-pausa); "2 semanas de volta" (2 semanas consecutivas de
participação pós-retorno); "4 semanas de volta" (idem, 4 semanas). Depois da 4ª semana, encerra-se
o episódio — o aluno volta a ser tratado normalmente pelas regras de constância/aderência/volume.
Definição operacional de gamificação, não afirmação fisiológica de recuperação completa.

## 14. Fora de escopo nesta versão

Objetivos pessoais (critérios heterogêneos demais); ciclos de treinamento completos; quantidade de
provas; recordes pessoais de tempo/pace (sem fonte confiável/padronizada de relógios ainda —
revisitar quando PANZ FIT/Garmin/Apple/COROS/Polar fornecerem dados adequados).

## 15. Graus das medalhas

Bronze → Prata → Ouro → Platina → Diamante → Lendária. Atributo visual/de dificuldade, nunca
pontuação fisiológica ou classificação do aluno. Raridade real (% da população que conquistou)
pode ser calculada depois com dados agregados — separado do grau pré-definido.

## 16. Próximas conquistas

O sistema calcula continuamente o progresso das medalhas não conquistadas, sempre com base em
**execução real** (ex: prescrição de 30km/semana, aluno executou 24,6km → mostra "24,6/30km",
independente do volume prescrito ser diferente do limiar da medalha). A Home **não** escolhe
simplesmente a medalha matematicamente mais próxima — precisa distinguir medalha disponível no
catálogo de medalha apropriada para aparecer como "próxima conquista". Volume muito acima da
prescrição atual não deve ser usado para estimular aumento de carga: uma medalha alcançada por
execução acima do prescrito é um fato histórico válido, mas não vira sugestão de próxima meta
quando incompatível com a prescrição atual do aluno.

## 17. Histórico

Cada conquista preserva: quem + qual medalha + quando + valor alcançado + período correspondente +
modalidade + evidência/origem + versão da regra. Precisa sobreviver a mudanças futuras na regra
(uma medalha conquistada sob a regra v1 não é reavaliada/revogada quando a regra vira v2).

## 18. Inteligência gerencial

Modelar desde já para permitir agregação futura: distribuição de alunos por patamar de volume
semanal/mensal, sustentação de patamares por N semanas, distância em corrida única, tempo entre
marcos, frequência/raridade de cada medalha, quantos estão perto de cada conquista, distribuição de
constância/aderência/feedbacks/reavaliações. Permitir futuramente análises de associação entre
comportamento de registro, aderência, continuidade e progressão — **sem transformar associação em
causalidade**.

---

## Checagem contra o modelo de dados atual (30/09/2026)

Ver mensagem de entrega no histórico da conversa para o mapeamento completo
`medalha → fonte canônica → calculável hoje / dependência / dúvida`. Resumo dos achados principais:

- **Reutilizável diretamente**: aderência/cobertura semanal (`EvolutionMetricService.calcAdherence/
  calcCoverage`), volume semanal e mensal (`buildWeeklyVolumes`/`buildMonthlyAggregates`), maior
  distância em corrida única (`training-plans.service.ts`, query `longestRunSession` — duplicada em
  `target-races.service.ts`, candidata a virar helper compartilhado), limiar de 14 dias de lacuna
  (`GAP_RETURN_THRESHOLD_DAYS`, `context-events`), contagem de reavaliações concluídas
  (`Reassessment.completedAt`), contagem de check-ins não pulados (`athlete-state-snapshot.service.ts`).
- **Achado que precisa de decisão antes de implementar a família 2 (Aderência)**: o código atual de
  `EvolutionMetricService` **inclui** sessões extras no denominador de aderência/cobertura
  (`bucket.prescritas++` roda para toda sessão, extra ou não) — isso **contradiz** a regra já
  documentada em `GLOSSARIO_METRICAS.md` ("Extra: não entra em prescrito/elegível/aderência").
  Esse é um bug/divergência entre doc e código já existente, independente do sistema de medalhas,
  mas bloqueia a implementação correta da família 2 e da "semana perfeita" até ser resolvido.
- **Existe schema dormente reaproveitável como ponto de partida**: `Achievement`/`UserAchievement`
  (`schema.prisma`, não usados em nenhum lugar do código) — têm o formato genérico
  `id/code/name/description/criteria(Json)` + `userId/achievementId/unlockedAt`, mas faltam campos
  que a especificação exige (grau, valor da conquista, período, modalidade, evidência, versão da
  regra) — precisam de extensão, não são suficientes como estão. `Challenge`/`ChallengeProgress`
  (também dormentes) parecem modelar outra ideia (desafios semanais), não medalhas permanentes —
  provavelmente não reaproveitáveis aqui.
- **Não existe ainda**: contagem total de treinos concluídos all-time (trivial de adicionar);
  contagem de feedbacks reais vs. perdidos all-time (campo existe, query não); sequência de semanas
  consecutivas COM LIMIAR de volume/aderência (só existe streak de "teve algum registro na semana");
  volume mensal filtrado por modalidade (só o semanal tem essa opção hoje); resultado real de prova
  (`TargetRace` só guarda status auto-declarado `em_andamento/concluida/arquivada`, sem verificação
  cruzada contra treino/distância real do dia da prova).

---

## Desenho técnico (30/09/2026) — schema + plano de implementação

> Ainda **NÃO implementar**. Este desenho serve para validação antes de qualquer migration/código.

### Pré-requisito: corrigir a divergência de aderência

Antes de qualquer medalha de aderência funcionar corretamente, corrigir
`EvolutionMetricService.fetchRawSessions`/`buildWeeklyVolumes`
(`apps/api/src/evolution/evolution-metric.service.ts`) para que sessões extras (`isExtra`) **não**
incrementem `bucket.prescritas`/`bucket.feitas`/`bucket.naoFeitas` — extra continua contribuindo
pra `kmTotal`/`kmExtrasTotal` (volume realizado), só sai do cálculo de aderência/cobertura. Isso
alinha o código com o que `GLOSSARIO_METRICAS.md` já documenta.
Teste específico obrigatório: uma semana com prescrito=4, concluído=3, não realizado=1, extra=2 →
aderência deve dar 75% (3/4), nunca 50% (3/6), e volume deve somar os km das 3 prescritas + 2
extras juntos.

### Schema (extensão das tabelas dormentes `Achievement`/`UserAchievement`)

Reaproveitar as tabelas já existentes no schema (nunca usadas por nenhum código hoje), estendidas
com os campos que a especificação exige. Nenhuma tabela nova de catálogo — mantém um único sistema.

```prisma
model Achievement {
  id          String   @id @default(uuid())
  code        String   @unique   // estável, nunca muda: "constancia_4_semanas", "volume_semanal_corrida_30km_sustentado_6_semanas"
  category    String              // constancia | aderencia | treinos_concluidos | volume_semanal |
                                   // sustentacao_volume | volume_mensal | distancia_unica | acumulado |
                                   // feedbacks | checkins | reavaliacoes | provas | retomada
  name        String
  description String
  grau        String              // bronze | prata | ouro | platina | diamante | lendaria
  threshold   Float               // limiar numérico (km, semanas, contagem, %...)
  unit        String?             // "km" | "semanas" | "treinos" | "checkins" | "%" | null
  ruleVersion Int      @default(1)
  criteria    Json                // parâmetros estruturados extras: modalidade, nº de semanas
                                   // consecutivas exigido, tipo de período (semana/mês/sessão/all-time),
                                   // patamar-pai (pra família de sustentação), etc — NUNCA lógica, só dado.
  sortOrder   Int      @default(0) // ordem dentro da família, usada pra progressão/"próxima conquista"
  active      Boolean  @default(true)
  createdAt   DateTime @default(now())
  users       UserAchievement[]

  @@index([category])
}

model UserAchievement {
  id                  String      @id @default(uuid())
  userId              String
  user                User        @relation(fields: [userId], references: [id])
  achievementId       String
  achievement         Achievement @relation(fields: [achievementId], references: [id])
  unlockedAt          DateTime    @default(now())
  value               Float                // valor EFETIVAMENTE OBSERVADO que gerou a conquista
  periodStart         DateTime?            // início do período correspondente (semana/mês/sessão)
  periodEnd           DateTime?
  modality            String?              // corrida | esteira | null quando não aplicável
  evidence            Json                 // rastreabilidade: sessionIds/completionIds/weekStart/
                                            // checkinIds/reassessmentId — nunca "confie, aconteceu"
  ruleVersionAtUnlock Int                  // snapshot da versão da regra no momento — sobrevive a
                                            // mudanças futuras na definição da medalha
  createdAt           DateTime   @default(now())

  @@unique([userId, achievementId])        // uma conquista por aluno, pra sempre — nunca duplica
  @@index([userId, unlockedAt])
}
```

`Challenge`/`ChallengeProgress` (também dormentes) ficam de fora — modelam outra ideia (desafios
semanais com progresso mutável), incompatível com "conquista permanente" deste sistema.

### Arquitetura de cálculo

Novo módulo `medals/` (nome de arquivo a definir na implementação):

- **Catálogo** (`medal-catalog.ts`, dados estáticos versionados): lista determinística de todas as
  definições de medalha (código, categoria, limiar, unidade, grau, critérios) — usada pra seed do
  banco, nunca reimplementada em outro lugar como "lógica paralela".
- **`MedalEvaluationService`**: nunca recalcula matemática que já existe — só LÊ as saídas já
  canônicas (`EvolutionMetricService` para constância/aderência/volume, o helper centralizado de
  `longestRunSession` para distância única, contagens diretas de `WeeklyCheckIn`/`Reassessment`,
  `context-events` para gap/retomada) e aplica comparação com limiar + contagem de sequência
  (streak com limiar), que É lógica nova específica de medalha, não duplicação.
- **Gravação idempotente**: `@@unique([userId, achievementId])` permite rodar a avaliação quantas
  vezes for preciso sem duplicar — mesmo padrão já usado no projeto pra evitar corrida em webhook
  (capturar P2002 e seguir, nunca travar o fluxo principal por causa disso).
- **Isolamento de falha**: avaliação de medalha nunca pode bloquear ou derrubar a ação real a que
  está associada (salvar treino, enviar check-in etc.) — sempre fire-and-forget com `.catch()`,
  mesmo padrão já usado em todo o codebase para efeitos colaterais não críticos.

### Pontos de disparo (nunca um cron novo e solto — reaproveitar os já existentes)

| Gatilho | Famílias avaliadas |
|---|---|
| Após `WorkoutCompletionsService.upsert()` | Treinos concluídos, distância única, feedbacks, retomada ("Voltei") |
| Fechamento semanal (mesma cadência do `weekly-plan-scheduler.service.ts`) | Constância, aderência, volume semanal, sustentação semanal, semana perfeita, retomada (2/4 semanas de volta) |
| Virada de mês-calendário (checada dentro do mesmo cron semanal) | Volume mensal, acumulado |
| Após `WeeklyCheckInService` (submit real, não pulado) | Check-ins |
| Após `ReassessmentService.complete()` | Reavaliações |
| (Inativo por ora) `TargetRacesService` marcar `concluida` | Provas — só quando houver evidência melhor que autodeclaração |

### Compatibilidade histórica (item 10 do pedido)

Contagem de check-ins precisa tratar os 2 sentinelas de "pulou" que já coexistem no banco:
`checkinSkipped=true` (v2) e `elaborationSatisfaction===0` (v1, registros antigos) — mesma
ressalva já documentada em `athlete-state-snapshot.service.ts`.

### Centralização (item 7 do pedido)

A query de `longestRunSession` está duplicada hoje (`training-plans.service.ts` e
`target-races.service.ts`, mesmo shape). Antes de uma terceira cópia nascer pro sistema de
medalhas, extrair um helper único (ex: em `evolution/` ou `training-intelligence/`) e migrar os 2
usos existentes pra ele.

### Endpoint (aluno)

`GET /me/medals` — devolve catálogo completo + status por medalha (conquistada/não, com
`unlockedAt`/`value`/`grau` quando conquistada) + progresso pras não conquistadas, já filtrado pela
regra de compatibilidade com a prescrição atual (uma medalha muito acima do que está prescrito não
aparece como "próxima conquista" recomendada, mesmo estando no catálogo).

Endpoint agregado pra gestão (seção 18) fica para uma etapa posterior, depois de existir volume
real de dados desbloqueados.

### Ordem recomendada de implementação (quando autorizado)

1. Corrigir a divergência de aderência (pré-requisito acima) + teste específico.
2. Migration estendendo `Achievement`/`UserAchievement` com os campos novos.
3. Seed do catálogo — começando pelas famílias 100% calculáveis hoje sem dependência (1, 3, 4, 5,
   6, 7, 8, 9, 10, 11, 13).
4. `MedalEvaluationService` + pontos de disparo da tabela acima.
5. `GET /me/medals` + UI mínima no app (sem isso ainda não há como o aluno ver nada).
6. Família 2 (aderência) e "semana perfeita" — só depois do fix do pré-requisito.
7. Família 12 (provas) — entra no catálogo documentada, mas avaliação fica desligada até existir
   evidência melhor que o status autodeclarado.
8. Inteligência gerencial (seção 18) — depois de existir volume real de conquistas desbloqueadas
   pra agregar.
