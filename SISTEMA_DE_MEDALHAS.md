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

## 1. Constância

Semana válida = pelo menos 1 sessão prescrita concluída naquela semana. Pausa formalmente
planejada pelo treinador não é tratada automaticamente como falha.

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

Primeira semana **encerrada** em que o aluno atingir: 10, 20, 30, 40, 50, 60, 75, 100 km.
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

Mês-calendário completo. Medalhas: 25, 50, 75, 100, 125, 150, 175, 200, 250, 300, 400, 500, 750
km/mês. As medalhas muito altas existem no catálogo mas não são apresentadas automaticamente como
objetivo recomendado.

## 7. Distância em uma única corrida

Primeira sessão válida que alcançar: 3, 5, 8, 10, 12, 15, 18, 21,1, 25, 30, 35, 42,195, 50 km.

Nomenclaturas especiais: 21,1km = "Meia distância / Primeira meia"; 42,195km = "Maratona";
≥50km = "Ultramaratona" (para o Panzeri Run, ultra começa em 50km, não logo acima da maratona).

## 8. Quilometragem acumulada

Soma de toda distância válida de corrida registrada. Medalhas: 100, 250, 500, 1.000, 2.500, 5.000,
10.000 km acumulados.

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

Agendar uma prova não gera conquista — só conclusão comprovada/registrada.

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

O sistema calcula continuamente o progresso das medalhas não conquistadas (ex: "26,4/30km",
"6/8 semanas ≥30km", "167/200km no mês", "87/100 treinos"). A Home **não** escolhe simplesmente a
medalha matematicamente mais próxima — precisa distinguir medalha disponível no catálogo de
medalha apropriada para aparecer como "próxima conquista". Volume muito acima da prescrição atual
não deve ser usado para estimular aumento de carga.

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
