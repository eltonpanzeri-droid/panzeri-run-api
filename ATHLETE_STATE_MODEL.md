# Athlete State Model do Panzeri Run

> Especificação conceitual complementar à
> [`DIRETRIZ_MESTRA_TRAINING_INTELLIGENCE.md`](DIRETRIZ_MESTRA_TRAINING_INTELLIGENCE.md) e à
> [`CAMADA_MATEMATICA_LONGITUDINAL.md`](CAMADA_MATEMATICA_LONGITUDINAL.md). Recebida de Elton em
> 25/09/2026. Documento de arquitetura, não plano de sprint.
>
> A Camada Matemática responde: *como cada variável está se comportando ao longo do tempo?* O
> Athlete State Model precisa responder: *considerando essas variáveis em conjunto, como esse
> atleta está neste momento, como chegou a esse estado e quais partes desse estado são relevantes
> para compreender sua resposta ao treinamento?* É a ponte entre dados matematicamente processados
> e interpretação/prescrição. Não é um score único — é o atleta representado como estado
> multidimensional, temporal e contextual.

## 1. Conceito central

```
ATHLETE STATE(t)
=
estado fisiológico + estado perceptivo + estado psicológico + estado comportamental
+ estado de treinamento + estado de recuperação + dor/saúde + performance
+ contexto de vida + história recente
```

O estado evolui continuamente (`STATE(t0) → eventos+treino+vida → STATE(t1) → ...`). `STATE(t)`
nunca deve ser interpretado separado da trajetória que levou até ele.

## 2. O estado não é um score

Não é `READINESS = 72`. Um índice pode existir futuramente como recurso visual/resumo, desde que
transparente, mas o objeto principal preserva os componentes — dois atletas podem chegar ao mesmo
72 por motivos opostos (ex: Atleta A com sono ruim + fadiga física alta + estresse baixo + motivação
alta vs. Atleta B com sono bom + fadiga mental alta + estresse alto + motivação baixa). Reduzir os
dois a um número destrói informação relevante pra decisão.

## 3. Estrutura principal (organização semântica, não necessariamente 11 tabelas/classes)

```
ATHLETE STATE
├── 01. TREINAMENTO
├── 02. RECUPERAÇÃO / SONO
├── 03. ESTADO FÍSICO
├── 04. ESTADO PSICOLÓGICO
├── 05. RESPOSTA AO TREINAMENTO
├── 06. DOR / SAÚDE
├── 07. PERFORMANCE / CAPACIDADE
├── 08. COMPORTAMENTO
├── 09. CONTEXTO DE VIDA
├── 10. DINÂMICA DO SISTEMA
└── 11. QUALIDADE DA EVIDÊNCIA
```

Primeiro auditar estruturas existentes (seção 36) antes de decidir implementação.

## 4. Treinamento

Representa o estímulo aplicado: volume (atual/semanal/recente/intermediário/histórico),
intensidade, frequência, distribuição de intensidade, modalidades, tipos de sessão, carga prescrita
vs. executada, aderência, consistência, sessões perdidas/extras, alterações recentes. `42 km/semana`
sozinho não basta — precisa saber se é habitual, acima/abaixo do habitual, crescendo, diminuindo,
mais/menos variável, sempre em relação à própria história do atleta.

## 5. Recuperação e sono

Usa os dados já estruturados no feedback diário (perguntas 1-5 do feedback v2): qualidade,
duração, irregularidade de horário, interrupções, dificuldade pra dormir — com padrão
recente/intermediário/longo, variabilidade, mudança da variabilidade, desvios, persistência,
recuperação após perturbações. **Sono não deve ser esmagado num único número** antes de preservar
seus componentes — duração, qualidade, regularidade, interrupção e dificuldade podem contar
histórias diferentes.

## 6. Estado físico

Fadiga física pré-treino, resposta física ao treino, fadiga física provocada pelo treino, tendência,
variabilidade, persistência, resposta a sessões semelhantes, recuperação entre sessões, relação com
carga recente. Distinção importante: **fadiga antes ≠ fadiga produzida pelo treino ≠ recuperação
posterior** — nunca misturar essas três informações.

## 7. Estado psicológico

Fadiga mental, estresse, vontade/motivação para treinar, experiência emocional durante o treino,
mudança mental pré→pós — com tendências, variabilidade, persistência, relações com contexto e
treinamento. Mesma regra de sempre: motivação alta = mais motivação, estresse alto = mais estresse,
fadiga mental alta = mais fadiga mental. Nunca "alto=ruim, baixo=bom" universalmente.

## 8. Resposta ao treinamento

Domínio particularmente importante: RPE, execução vs. prescrito, satisfação com elaboração,
resposta física/mental, experiência emocional — segmentado por tipo de sessão (leve, longo, limiar,
intervalado, força, outros), por intensidade, volume, duração, e recuperação posterior. Objetivo
futuro: `easy: habitual`, `long: well_tolerated`, `threshold: response_below_recent_pattern`,
`interval: higher_RPE_than_comparable_sessions` — muito mais informativo que uma média geral de RPE.

## 9. Dor e saúde

**Dor ≠ lesão**, tratadas separadamente. Dor atual (localização, intensidade, início, duração,
recorrência), se alterou/impediu/modificou o treino, relação temporal com carga e tipos de sessão,
episódios anteriores, recuperação. Diagnóstico profissional registrado pode existir como dado
próprio, sem transformar dor automaticamente em lesão. Métrica futura mais defensável que "quantos
alunos tiveram dor": **episódios de dor que modificaram ou impediram treinamento por 100 sessões**.

## 10. Performance e capacidade

Provas, testes, pace, velocidade, potência quando disponível, FC, distância, duração, capacidade de
volume/intensidade/frequência, estímulos comparáveis, evolução longitudinal. Performance não é só
"correu mais rápido" — pode ser adaptação real quando: mesmo pace → menor RPE; mesma sessão → menor
fadiga; mesmo volume → recuperação mais rápida; maior volume → mesma resposta interna; mesmo
estímulo → menor perturbação; mesma perturbação → retorno mais rápido.

## 11. Comportamento

Aderência, frequência, consistência, abandono de sessões, alterações da prescrição, sessões extras,
regularidade de feedback/check-in, padrão de execução, mudanças comportamentais. Aderência também
precisa de contexto — `histórico 88% / 60d 91% / 21d 68%` é informação real, diferente de só
"aderência = 82%".

## 12. Contexto de vida

Domínio de primeira classe no modelo, não anotação secundária: trabalho (emprego, horários, demanda,
viagens), família, rotina, viagens, saúde, medicação quando registrada, ambiente, eventos
importantes, ciclo menstrual quando aplicável, observações livres relevantes. O treinamento acontece
dentro disso.

## 13. Eventos contextuais

```
CONTEXT EVENT
type: work_change
subtype: increased_travel
startedAt / reportedAt / endedAt: ...
status: ongoing
source: athlete_report
originalText: "Troquei de emprego e agora viajo duas vezes por semana."
```

Nunca perder o texto original — a estrutura serve pra análise, o texto preserva nuance.

## 14. O contexto deve ser procurado quando o sistema muda

Quando a camada matemática detectar mudança relevante (sono↓, variabilidade sono↑, estresse↑,
fadiga↑, aderência↓, com carga de treino estável), o sistema procura temporalmente: mudança de
trabalho, viagem, família, doença, medicação, rotina, dor, prova, mudança de treinamento, comentário
livre, check-in semanal. Sem explicação registrada, pode surgir solicitação curta ao atleta —
transformando informação qualitativa em contexto longitudinal.

## 15. Evento não significa causa

Guardar separadamente: `EVENTO RELATADO` (mudança de emprego) + `MUDANÇA OBSERVADA` (sono↓, fadiga↑,
aderência↓) + `RELAÇÃO TEMPORAL` (ocorreram próximas). **Nunca** "mudança de emprego CAUSOU queda do
sono" — causalidade é inferência muito mais forte que isso.

## 16. Dinâmica do sistema

Aqui o Athlete State Model aproveita toda a Camada Matemática Longitudinal: nível atual, tendência,
variabilidade, mudança da variabilidade, estabilidade, excursões atuais/recentes, persistência,
retorno e velocidade de retorno, recuperação do nível e da variabilidade, mudanças coordenadas,
perturbações, possível mudança de regime, relações individuais relevantes. Descreve **como o sistema
está se comportando**, não só seus valores.

## 17. Estado atual carrega história suficiente

```
physicalFatigue: current=4, short=3.8, medium=3.2, long=2.6
variability: above_habitual, variabilityTrend: rising, direction: rising
persistence: 12d, excursion: active, returnPattern: slower_than_habitual
```

Isso já conta uma história por si só.

## 18. Mudanças coordenadas

Sono↓ (variabilidade↑) + fadiga↑ (variabilidade↑) + estresse↑, motivação estável, aderência↓, carga
estável — **não** deve virar 5 alertas independentes. Representar como:

```
COORDINATED CHANGE
affectedDomains: [sleep, physical_fatigue, stress, adherence]
preservedDomains: [motivation]
trainingLoad: stable
onset: approximately same period
knownContext: [work_change, increased_travel]
```

Extremamente importante pra IA interpretar corretamente.

## 19. O estado preserva o que está estável

Não mandar só problemas. Se fadiga↑ e sono↓, mas motivação estável, performance estável, dor
ausente, aderência alta — isso muda completamente a interpretação. O State Model representa
**o que mudou + o que não mudou**. Estabilidade também é informação.

## 20. Estado prévio + estímulo + resposta + estado posterior

Unidade fundamental: `STATE(t0) → TRAINING STIMULUS → ACUTE RESPONSE → RECOVERY → STATE(t1)`. Para
cada episódio relevante, reconstruir essa sequência completa (estado antes → treino → resposta
imediata → 24h → 48h → retorno à faixa habitual) — isso constrói a assinatura individual de
resposta.

## 21. Resposta condicionada ao estado anterior

O mesmo treino produz respostas diferentes conforme o estado em que o atleta chega
(`TREINO X + STATE A = RESPOSTA Y` ≠ `TREINO X + STATE B = RESPOSTA Z`). Não aprender só "como Maria
responde a intervalados?" — aprender "como Maria responde a intervalados quando chega em diferentes
estados?". Mudança conceitual fundamental.

## 22. Estado depende da história

Dois atletas com `fadiga=4` hoje podem ter trajetórias opostas (`2→2→2→4` vs. `5→5→4→4`) — o valor
atual é igual, a história é completamente diferente. `STATE(t)` não pode ser interpretado só pelas
observações de `t`; precisa carregar características da trajetória recente.

## 23. O Athlete State Snapshot

`ATHLETE STATE MODEL → ATHLETE STATE SNAPSHOT → AGENTE` — o modelo é rico, o agente não precisa
receber tudo, só o objeto compacto:

```json
{
  "goal": { "event": "half_marathon", "daysToEvent": 74 },
  "training": { "weeklyVolumeKm": 42, "volumeTrend": "stable", "adherence28d": 0.89 },
  "recovery": { "sleep": { "current": 2, "short": 2.8, "medium": 3.4, "long": 3.7, "variability": "rising" } },
  "physicalState": { "fatigue": { "current": 4, "short": 3.8, "long": 2.6, "trend": "rising", "persistenceDays": 12 } },
  "psychologicalState": { "motivation": "preserved", "stress": "above_habitual" },
  "response": { "easy": "habitual", "long": "habitual", "threshold": "below_recent_pattern", "interval": "higher_RPE_than_comparable_sessions" },
  "pain": { "active": false },
  "context": [{ "type": "work_change", "subtype": "increased_travel", "status": "ongoing" }],
  "dynamics": { "stability": "reduced", "affectedDomains": ["sleep", "physical_fatigue", "stress"], "recoveryPattern": "slower_than_habitual" },
  "dataQuality": {}
}
```

Exemplo conceitual — **não copiar cegamente como schema antes da auditoria** (seção 36).

## 24. O Snapshot é seletivo (3 níveis)

- **Level 1 (sempre)**: objetivo, fase, carga recente, aderência, estado atual, sono, fadiga,
  estresse, motivação, dor, resposta recente, principais tendências.
- **Level 2 (quando relevante)**: evento contextual, mudança de regime, dor recorrente, sono
  anormal, resposta deteriorando, ciclo menstrual relevante, perturbação ativa, variabilidade
  alterada.
- **Level 3 (sob demanda)**: histórico profundo, sessões específicas, reavaliações antigas, relações
  detalhadas, evidências de hipóteses, timeline completa.

Reduz tokens sem destruir contexto.

## 25. Qualidade da evidência acompanha o estado

O agente precisa diferenciar "há forte histórico individual desse padrão" de "isso apareceu duas
vezes". Componentes importantes carregam `n`, `coverage`, `recency`, `instrumentVersion`,
`dataCompleteness`, `consistency`. Nunca inventar certeza.

## 26. Hipóteses individuais pertencem ao modelo

```
HYPOTHESIS H07
"Viagens profissionais parecem anteceder maior instabilidade do sono."
evidence: { episodes: 9, consistency: ..., typicalLag: ..., magnitude: ... }
status: exploratory
```

Atualizáveis: `strengthened / weakened / uncertain / contradicted / obsolete`. Nunca virar
característica permanente da pessoa.

## 27. Ciclo menstrual como contexto individual

Quando aplicável e voluntariamente registrado: datas de menstruação, fase estimada, regularidade,
sintomas, contexto de contraceptivo hormonal. **Não** aplicar regra universal tipo "fase X = reduzir
treino" — o objetivo é descobrir se aquela atleta específica apresenta padrões repetidos
relacionados a determinado contexto (ex: sintomas moderados + fadiga física +0.7 vs. habitual, sem
efeito detectado em performance).

## 28. Serve também ao Evolution Agent

Snapshot responde "como ele está agora" (curto prazo, decisão imediata); Evolution Report responde
"como ele mudou" (meses, trajetória, adaptação, mudanças estruturais). O agente de prescrição recebe
os dois, futuramente.

## 29. Evolução não é só performance

Acompanhar: performance, capacidade de treinamento, tolerância ao estímulo, recuperação,
estabilidade, aderência, sono, fadiga, estresse, motivação, dor limitante, comportamento, qualidade
de vida quando medida.

## 30. Prepara a avaliação do próprio método

No nível populacional, futuramente: quantos melhoraram performance/capacidade de treinamento; a
aderência melhorou; o RPE pra estímulos comparáveis mudou; recuperação mais rápida; episódios de dor
limitante diminuíram; sono melhorou; estabilidade aumentou; motivação permaneceu; quantos continuam
treinando; distribuição dessas mudanças entre alunos — sempre respeitando elegibilidade,
denominador e disponibilidade de dados, **nunca** transformando observação longitudinal
automaticamente em causalidade do método.

## 31. Relação com sistemas complexos

O State Model cria o objeto necessário pra próxima camada (`STATE A → STATE B → STATE C`),
habilitando estudo de estados recorrentes, transições, perturbações, trajetórias, dependência do
estado/história, estabilidade, mudanças de regime, propagação, recuperação, adaptabilidade. Sem
State Model, só teríamos dezenas de séries temporais soltas.

## 32. Não criar estados arbitrários cedo demais

Não definir `STATE A = cansado / STATE B = recuperado / STATE C = estressado` e forçar os dados a
caber nisso. Primeiro preservar o espaço multidimensional; com dados suficientes, estados
recorrentes podem ser investigados empiricamente e só depois interpretados.

## 33. O mesmo vale pra "estabilidade"

Não criar `stabilityScore = 74` sem definição. Primeiro preservar variabilidade, mudança da
variabilidade, excursões, persistência, velocidade de retorno, número de dimensões deslocadas,
recuperação. Índice composto só depois, se fizer sentido.

## 34. Frontend precisa explicar o estado

Se aparecer "fadiga física acima do padrão", o treinador clica e vê: atual/MM21/MM60/MM200, início
estimado, número de observações, variabilidade, contexto próximo, carga. **Nenhuma caixa-preta.**

## 35. Drill-down obrigatório

```
STATE → DOMÍNIO → VARIÁVEL → MÉTRICA → SÉRIE TEMPORAL → OBSERVAÇÃO → REGISTRO ORIGINAL
```

Exemplo: Recuperação alterada → Sono → Qualidade → MM21 → 6 respostas → 23/09 → feedback original.
Isso torna a inteligência auditável.

## 36. Auditoria antes da implementação

Antes de criar qualquer estrutura nova, verificar: `WorkoutCompletion`, feedback v1/v2,
`WeeklyCheckIn` v1/v2/v3, dor, planos/sessões de treino, Strava, perfil do aluno, readiness atual,
Evolution Agent, prescription agent, training methodology, analytics, Data Layer, prontuário,
eventos existentes, campos de rotina/saúde/contexto. Procurar: conceitos duplicados, nomes
diferentes pra mesma coisa, semântica incompatível, dados já existentes, campos abandonados,
cálculos no frontend, cálculos duplicados, scores antigos, versões misturadas. Consolidar antes de
ampliar.

## 37. Não destruir legado

Feedbacks antigos continuam sendo história válida dentro da semântica da versão em que foram
coletados. Não converter silenciosamente v1→v2 como se as perguntas fossem idênticas. Quando houver
equivalência segura, documentar; quando não houver, marcar `not_comparable` /
`partially_comparable` (ou equivalente) — exatamente o que já foi feito em
`GLOSSARIO_METRICAS.md` pro feedback v2 e check-in v3.

## 38. Arquitetura final esperada

```
                    PANZERI DATA LAYER
                           │
                           ▼
                    CANONICAL SEMANTICS
                           │
                           ▼
              MATHEMATICAL LONGITUDINAL LAYER
                           │
                           ▼
                   ATHLETE STATE MODEL
                           │
              ┌────────────┼────────────┐
              ▼            ▼            ▼
         DASHBOARD      EXPLORER    SYSTEM MODEL
                                        │
                                        ▼
                             ATHLETE STATE SNAPSHOT
                                        │
                             ┌──────────┴──────────┐
                             ▼                     ▼
                      EVOLUTION AGENT      PRESCRIPTION AGENT
```

Outros módulos futuros (ex: nutrição) consomem a mesma fundação sem criar silos.

## 39. Regra central

*"O Athlete State Model não existe para classificar o atleta. Existe para representar, com a menor
perda possível de informação relevante, o estado atual daquele indivíduo dentro de sua própria
trajetória, incluindo aquilo que mudou, aquilo que permaneceu estável, o contexto em que a mudança
ocorreu e a qualidade da evidência disponível."*

## 40. Resultado esperado (progressão de sofisticação)

- Hoje: *"Qual foi a fadiga?"*
- Com a Camada Matemática: *"Como a fadiga está se comportando?"*
- Com o Athlete State Model: *"O que está acontecendo com esse atleta?"*
- Com o Individual System Model: *"Como esse atleta costuma funcionar e como chegou até aqui?"*
- Com o agente de prescrição: *"Diante de quem esse atleta é, do estado em que se encontra, de como
  chegou até aqui, de como costuma responder e do objetivo que temos pela frente, qual é a decisão
  de treinamento mais coerente agora?"*

Esse é o papel do Athlete State Model dentro da arquitetura do Panzeri Run.
