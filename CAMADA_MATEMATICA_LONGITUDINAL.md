# Camada Matemática e Longitudinal do Panzeri Run

> Especificação da arquitetura-base de Training Intelligence — não um conjunto de gráficos ou
> fórmulas isoladas. Dashboard, Explorador de Dados, Athlete State Snapshot, Evolution Report,
> análises de sistemas complexos e agentes devem consumir **a mesma** camada matemática e semântica.
> Recebida de Elton em 25/09/2026, complementar à
> [`DIRETRIZ_MESTRA_TRAINING_INTELLIGENCE.md`](DIRETRIZ_MESTRA_TRAINING_INTELLIGENCE.md) (seção 5 —
> Camada matemática comum). Documento de arquitetura, não plano de sprint.

**Ideia central**: não queremos apenas saber o valor de uma variável. Queremos entender seu padrão
individual, como esse padrão varia, quando ele muda, como outras variáveis mudam junto, o que
aconteceu antes da mudança e como o sistema se reorganiza depois. A IA entra depois para interpretar
esse sistema; a matemática prepara os dados de forma compacta, consistente, auditável e
economicamente eficiente.

## Para que serve isso (contexto de Elton, 25/09/2026)

Essa camada inteira existe para avaliar, ao longo do tempo e sob vários ângulos: **risco de
dor/lesão, qualidade de vida, performance, bem-estar, melhora do sono, fatores de saúde em geral**.
No longo prazo, o Panzeri Run terá outros tipos de dado e outros módulos além do treino (ex:
nutrição) — a meta é **saber de tudo por vários ângulos**, sempre na mesma arquitetura longitudinal,
não em silos paralelos por módulo.

## 1. Arquitetura conceitual

```
DADOS BRUTOS
    ↓
CAMADA SEMÂNTICA
    ↓
CAMADA MATEMÁTICA LONGITUDINAL
    │
    ├── nível
    ├── médias
    ├── médias móveis
    ├── baseline
    ├── variabilidade
    ├── tendência
    ├── desvios
    ├── persistência
    ├── excursões
    ├── recuperação
    └── qualidade do dado
    ↓
CAMADA DE RELAÇÕES
    │
    ├── associações
    ├── relações temporais
    ├── lags
    ├── relações condicionais
    └── eventos contextuais
    ↓
DINÂMICA DO SISTEMA
    │
    ├── estados
    ├── estados recorrentes
    ├── transições
    ├── perturbações
    ├── estabilidade
    ├── recuperação
    ├── adaptabilidade
    └── mudança de regime
    ↓
TRAINING INTELLIGENCE
    │
    ├── sinais
    ├── hipóteses individuais
    ├── Athlete State Snapshot
    └── Evolution Report
    │
    ├───────────────┐
    ↓               ↓
DASHBOARD         AGENTES
```

Não existe matemática diferente no dashboard, no agente e em relatórios. Fonte matemática canônica
única.

## 2. A unidade fundamental é a observação

Tudo começa em observações preservadas individualmente.

```
OBSERVATION

athleteId
variableId
value
timestamp
unit
scale
context
source
instrumentVersion
workoutId
metadata
```

Exemplo concreto:

```
athlete: Maria
variable: prePhysicalFatigue
value: 4
scale: 1-5
timestamp: 2026-09-23 06:42
context: pre_workout
workoutId: xxx
feedbackVersion: 2
source: athlete_report
```

O dado bruto nunca é substituído pelo derivado. Médias, tendências, baselines, relações, estados e
hipóteses são camadas derivadas. Sempre precisa ser possível:

```
AGREGADO → ALUNO → PERÍODO → OBSERVAÇÃO → REGISTRO ORIGINAL
```

## 3. Cada variável precisa conhecer sua própria semântica

Não aplicar automaticamente a mesma matemática a todas as variáveis. Cada variável precisa de
definição canônica contendo, quando aplicável:

```
variableId, name, domain, dataType, scale, unit, semanticDirection, source,
instrumentVersion, expectedFrequency, allowedAggregations, allowedWindows,
missingDataPolicy, zeroMeaning, comparisonRules
```

Exemplo:

```
prePhysicalFatigue
domain: readiness
type: ordinal
scale: 1-5
1 = fadiga muito baixa | 5 = fadiga muito alta
higherMeans: more_fatigue
source: daily_feedback
zero: not_valid
missing: no_response
```

Regra permanente: **5 não significa universalmente bom** — o número representa magnitude/sentido do
construto. Categorias não devem virar escalas contínuas artificialmente quando isso não fizer
sentido (ex: duração do sono já é categórica no feedback v2, não deve virar 1-5).

## 4. Separar dado, matemática, sinal e interpretação

```
DADO BRUTO → MÉTRICA DERIVADA → SINAL → INTERPRETAÇÃO
```

Exemplo — dado: `fadiga: 2, 2, 3, 3, 4, 4, 4`. Métricas: `média período = 3,14`, `MM21 = 3,7`,
`MM60 = 3,1`, `MM200 = 2,6`. Sinal: `physical_fatigue_above_long_baseline` (magnitude +1.1,
persistence 9d, observations 6). Interpretação (da IA): aumento recente de fadiga relevante para a
decisão atual — a IA não precisa receber 200 respostas para descobrir isso; o backend calcula
deterministicamente.

## 5. Horizontes por variável

Quando apropriado: valor atual, média do período selecionado, média móvel curta, média móvel
intermediária, média móvel longa, baseline/faixa habitual.

Janelas iniciais sugeridas (não fixas): curta 21 dias, intermediária 60 dias, longa 200 dias — mas a
arquitetura precisa suportar qualquer janela (7, 14, 21, 28, 42, 60, 90, 120, 180, 200, 365...) sem
alterar schema ou reconstruir o sistema.

## 6. Janela temporal ≠ janela por observações

Dois conceitos diferentes precisam de suporte:
- **Tempo cronológico**: últimos 7/21/60/200 dias.
- **Tempo de treinamento/observações**: últimas 3/5/10 sessões, últimos 5 longos, últimos 10
  intervalados.

"Como está a fadiga nos últimos 21 dias?" e "Como respondeu aos últimos cinco treinos de limiar?"
são perguntas diferentes — ambas precisam ser suportadas.

## 7. Período visualizado não é janela matemática

Visualizar os últimos 90 dias não impede sobrepor MM21/MM60/MM200 — a MM200 usa dados anteriores ao
início dos 90 dias exibidos quando existirem. Nunca recalcular uma MM200 usando artificialmente só
o período visível. Distinção precisa existir no backend e no frontend.

## 8. Janelas incompletas não desaparecem automaticamente

```
MM21 = 3.4
requestedWindow = 21d
observedSpan = 12d
nObservations = 6
maturity = partial
```

Separar "existe um cálculo" de "quanta evidência sustenta esse cálculo" — não esconder o primeiro
só porque o segundo ainda é pequeno.

## 9. Qualidade da informação acompanha o número

Para métricas derivadas relevantes: `nObservations`, `requestedWindow`, `observedSpan`,
`expectedObservations`, `completionRate`, `lastObservationAge`, `source`, `instrumentVersion`,
`dataQuality`.

**Não** criar uma falsa precisão do tipo `confidence = 83.72%` sem base sólida. Preferir componentes
transparentes agora; níveis como `insufficient / early / developing / established` só depois, com
critérios explícitos por tipo de análise.

## 10. Baseline individual é dinâmico

Baseline ≠ "média de tudo que essa pessoa já respondeu". Preservar horizontes diferentes: histórico
completo, longo, intermediário, recente — todos coexistindo, nenhum apagando o anterior. Uma
divergência entre eles (ex: sono histórico 3,1 / MM200 3,3 / MM60 3,7 / MM21 4,1) pode representar
mudança real do sistema.

## 11. Desvios entre horizontes

Não olhar só o valor absoluto: atual vs. curta/intermediária/longa, curta vs. intermediária/longa,
intermediária vs. longa. Isso diferencia um pico isolado de um deslocamento progressivo.

## 12. Nível e tendência são coisas diferentes

Duas séries podem ter a mesma média e direções opostas. Sempre que aplicável: `level`, `slope`,
`direction`, `magnitude`. Rótulos interpretativos (`above_habitual`, `rising`, `moderate`...) devem
derivar de critérios transparentes, nunca de impressão visual.

## 13. O padrão individual inclui a variabilidade

Padrão = **centro + variabilidade habitual**, não um único número. "O normal é 10" é insuficiente se
a pessoa costuma oscilar entre 8 e 12 — isso é informação real do padrão, não ruído a ignorar.

## 14. A variação da própria variação importa

A média pode permanecer estável enquanto o comportamento do sistema muda de verdade (oscilação mais
ampla/errática). Acompanhar: `level`, `variability`, `variability_change`, `trend`, `persistence`,
`excursion_frequency`, `excursion_magnitude`, `return_dynamics`. Não escolher agora uma estatística
universal de "variabilidade da variabilidade" — a infraestrutura precisa permitir estratégias
diferentes por tipo de variável.

## 15. Faixa habitual individual

Região habitual além da média — desvio padrão, percentis, IQR, MAD ou outra medida robusta conforme
o dado. Para escalas ordinais 1-5, não presumir distribuição normal.

## 16. Uma excursão não termina no valor extremo

Sair da faixa habitual (ex: pico de 13 numa faixa 8-12) não é o fim da história — o que acontece
depois é que conta: retorno rápido, retorno progressivo, persistência do deslocamento, oscilação
ampliada (média volta perto do normal, mas estabilidade mudou), ou reorganização pra outro regime.
São fenômenos diferentes que a arquitetura precisa distinguir.

## 17. Modelar excursão e retorno

```
EXCURSION: startedAt, direction, peak, magnitude, duration, observations

RETURN DYNAMICS: returned, returnTime, returnObservations, returnVelocity,
overshoot, stabilityAfterReturn, returnedToPreviousBaseline, possibleNewBaseline
```

Isso permite estudar como cada indivíduo retorna depois de ser deslocado — dimensão considerada
extremamente importante.

## 18. Recuperação do nível ≠ recuperação da variabilidade

Um sistema pode recuperar a média sem recuperar a estabilidade. Distinguir: `LEVEL RECOVERY`,
`VARIABILITY RECOVERY`, `SYSTEM DYNAMICS RECOVERY`. Relevante para entender recuperação e
adaptabilidade de verdade.

## 19. Persistência é dimensão própria

Quando saiu da faixa, por quantos dias/observações, qual magnitude, houve retorno, quanto demorou,
voltou a sair. Pico isolado e deslocamento persistente não recebem o mesmo peso interpretativo.

## 20. Três famílias de mudança

```
CHANGE DETECTION
├── LEVEL CHANGE (mudança do centro)
├── VARIABILITY CHANGE (mudança da dispersão)
└── DYNAMIC CHANGE (persistência, retorno, frequência de excursões, propagação, transições)
```

Muito mais rico que só detectar "média subiu".

## 21. Mudança de variabilidade pode anteceder mudança de média

Ex: sono estável em média mas variabilidade sobe (semana 2) → sono médio cai (semana 3) → fadiga
sobe (semana 4) → aderência cai (semana 5). A primeira mudança observável pode ser instabilidade,
não o valor médio — precisa ser detectável como tal.

## 22. Eventos contextuais entram na camada longitudinal

O atleta não existe isolado do resto da vida: trabalho, família, saúde, rotina, ambiente. Esses
eventos não ficam só como texto perdido no prontuário — quando possível, viram eventos estruturados
e temporalmente localizados:

```
CONTEXT_EVENT
type: work_change
subtype: increased_travel
startedAt: 2026-09-01
reportedAt: 2026-09-23
status: ongoing
description: "Mudou de emprego e passou a viajar aproximadamente duas vezes por semana."
source: athlete_report
```

Preservar sempre o texto original também.

## 23. Quando detectar mudança, procurar contexto

Comportamento da própria Training Intelligence: ao ver MM curta de sono↓/estresse↑/fadiga↑/
aderência↓ com carga de treino estável, investigar se há evento contextual, comentário livre,
check-in semanal, mudança de rotina, viagem, dor/doença, mudança de trabalho ou mudança relevante de
treinamento próxima. Sem contexto suficiente, pode gerar pergunta ativa ao atleta (ex: "Percebemos
algumas mudanças no seu padrão... aconteceu alguma mudança importante na sua rotina, trabalho,
viagens, família, saúde?"). Objetivo: enriquecer a série temporal com contexto, não diagnosticar.

## 24. Evento contextual e mudança observada ficam separados

Obrigatório. Guardar `REPORTED EVENT` + `OBSERVED SYSTEM CHANGE` + `TEMPORAL RELATION` (event
precedes/coincides with change) — **nunca** guardar `CAUSE` ("novo emprego causou queda do sono").
Causalidade não está demonstrada.

## 25. Contexto pode virar variável

Com dados suficientes, "viajar" deixa de ser só anotação e vira comparação (semanas com viagem vs.
sem viagem: sono, fadiga, RPE, aderência), gerando uma hipótese individual (`context: work_travel`,
`observed_pattern`, `n`, `consistency`, `lag`, `status: exploratory`).

## 26. Relações temporais com defasagem

Não só `Sono ↔ RPE`, mas `Sono(t) ↔ RPE(t)`, `Sono(t-1) ↔ RPE(t)`, `Sono(t-2) ↔ RPE(t)`; volume dos
últimos 7d → fadiga atual; estresse atual → sono seguinte; fadiga atual → execução próxima sessão;
treino intenso → estado 24h/48h depois. A defasagem é parte da relação.

## 27. Relações aceitam contexto

Associação global fraca pode ser forte sob contexto (`sono × RPE quando sessionType = interval`).
Estrutura: `RELATION { variableA, variableB, lag, context, period, n, association,
effectMagnitude, consistency, dataQuality }`. Sempre mantendo: associação não é causalidade.

## 28. Treino como perturbação do sistema

```
ESTADO PRÉ → ESTÍMULO → RESPOSTA AGUDA → RECUPERAÇÃO → NOVO ESTADO
```

Assinatura do estímulo: `type, subtype, volume, intensity, duration, structure, goal,
prescribedLoad, executedLoad` — permite comparar respostas a estímulos semelhantes.

## 29. Conceito de estímulo semelhante

Não comparar tudo com tudo — comparar, por exemplo, longos de 20-24km em intensidade/contexto
comparável entre dois períodos. Mesmo sem mudança dramática de performance, o sistema pode ter
mudado sua resposta ao estímulo (dimensão de adaptação).

## 30. Estado multidimensional

`readiness = 72` como score-resumo pode existir, mas não pode destruir os componentes. Estado real:
`STATE VECTOR { sleep, sleep_variability, physical_fatigue, mental_fatigue, stress, motivation,
pain, recent_load, load_variability, adherence, recent_response, context_events, ... }`. Com
histórico suficiente, investigar estados/regimes recorrentes sem defini-los antecipadamente.

## 31. Estados recorrentes e transições

Matriz de transição (`A→A, A→B, A→C...`) é menos interessante que **o que costuma anteceder**
determinada transição (ex: `STATE A + sono instável + viagem + volume elevado → STATE C`).

## 32. Perturbação e recuperação

```
BASELINE → PERTURBAÇÃO → DESLOCAMENTO → PICO → RECUPERAÇÃO → ESTADO FINAL
```

Medir: magnitude, direção, tempo até o pico, quantas variáveis afetadas, persistência, tempo de
recuperação, observações até recuperação, velocidade de retorno, recuperação da variabilidade,
overshoot, estado final.

## 33. Adaptabilidade multidimensional

Não virar score arbitrário agora — preservar componentes: magnitude da resposta, propagação entre
variáveis, persistência, retorno, recuperação da variabilidade, estado final.

## 34. Mudança de regime

Um atleta pode sair do padrão e voltar, ou genuinamente migrar de baseline
(`BASELINE A → EVENTO/PROCESSO → TRANSIÇÃO → BASELINE B`). Depois de meses estáveis no novo padrão,
não faz sentido tratá-lo eternamente como "desvio do normal antigo" — mas também não apagar que
antes o padrão era outro. Preservar `previousRegime`, `transitionPeriod`, `currentRegime` e todo o
histórico correspondente.

## 35. Hipóteses individuais

```
H07
statement: "Semanas com viagem profissional parecem anteceder piora do sono e maior fadiga."
status: exploratory
nEpisodes: 14
lag: 1-3d
consistency: moderate
firstObserved / lastUpdated: ...
```

Novos dados podem fortalecer, enfraquecer, manter incerta, contradizer ou tornar obsoleta — nunca
verdades permanentes.

## 36. Mudanças coordenadas entre variáveis

Não só detectores independentes. Distinguir "sono/estresse/motivação/RPE com variabilidade↑ e
volume estável" (sugere perturbação contextual não registrada) de "volume↑/fadiga↑/RPE↑" (resposta
esperada a mais carga). Produzir algo como `SYSTEM_CHANGE { levelChange, variabilityChange,
affectedDomains, trainingLoad, knownContext, nextAction: seek_context }`.

## 37. Athlete State Snapshot é o produto comprimido

Não mandar histórico bruto pra IA — mandar o snapshot (ver estrutura completa na seção 11 da
Diretriz Mestra, refinada aqui com `deviationLong`, `persistence`, `systemDynamics.recoveryPattern`,
`individualPatterns` com lag/n/confidence, `context`, `dataQuality`, `signals`). O agente recebe
informação, não uma montanha de dados.

## 38. A IA continua não determinística onde deve ser

Nunca `SE fadiga > 3.5 ENTÃO reduzir treino 20%`. A matemática descreve com precisão o que está
acontecendo, o que mudou, há quanto tempo, quanto, como costuma variar, como está variando agora, o
que aconteceu antes, quais variáveis mudaram juntas, como o atleta costuma responder e recuperar,
quais eventos contextuais existem, quanta evidência há. Só depois: Training Intelligence +
Metodologia Panzeri + objetivo + fase + contexto + histórico + IA → decisão.

## 39. Dashboard, Explorer e agentes falam a mesma língua

Se o dashboard mostra `MM21 fadiga = 3,7`, o agente recebe o mesmo `3,7` — da mesma função/camada
canônica, nunca recalculado separadamente. Mesma origem para rótulos como "variabilidade crescente"
= `variabilityTrend: rising`.

## 40. O Explorador investiga essa matemática

Por variável: período (7d/21d/60d/3m/6m/1a/tudo/personalizado), agrupamento (sessão/dia/semana/mês),
camadas visuais (bruto, médias, MMs, faixa habitual, variabilidade, eventos contextuais, excursões,
mudanças detectadas), cruzamento com qualquer variável semanticamente compatível, sempre com
drill-down até o registro original.

## 41. Não criar fórmula universal de variabilidade agora

Dados diferentes (pace, km, RPE 1-10, fadiga 1-5, sono categórico, dor, aderência, eventos binários)
pedem medidas de dispersão diferentes. Arquitetura como `VariabilityStrategy` /
`BaselineStrategy` / `TrendStrategy` / `AggregationStrategy` / `ChangeDetectionStrategy` (nomes
ilustrativos) — o princípio é não hardcodar uma fórmula universal pra todos os dados.

## 42. Antes de implementar, auditar o que já existe

Antes de criar estrutura nova, verificar: schema atual; serviços de analytics existentes; funções de
média/tendência; readiness atual; Data Layer; endpoints do dashboard; cálculos do Admin; dados do
feedback v1/v2; check-in v1/v2/v3; Training Intelligence existente; Evolution Agent; prescription
agent; prontuário; Strava; tratamento atual de dor; estruturas de eventos/contexto existentes.
Procurar especialmente: duplicidade, mesmo conceito com nomes diferentes, fórmulas diferentes pra
mesma métrica, semântica invertida, estruturas parcialmente sobrepostas, cálculo no frontend que
deveria ser canônico, histórico misturado entre versões. **Nunca** uma segunda arquitetura paralela
— sempre consolidar o que já existe nessa direção.

## 43. Ordem lógica interna de construção

```
SEMÂNTICA CANÔNICA → OBSERVAÇÕES/SÉRIES TEMPORAIS → AGREGAÇÕES → MÉDIAS/MÉDIAS MÓVEIS
→ BASELINES → VARIABILIDADE → VARIABILIDADE DA VARIABILIDADE → TENDÊNCIA → DESVIOS
→ PERSISTÊNCIA → EXCURSÕES → RETORNO/RECUPERAÇÃO → CHANGE DETECTION → EVENTOS CONTEXTUAIS
→ RELAÇÕES TEMPORAIS → RELAÇÕES CONDICIONAIS → ESTADOS → TRANSIÇÕES → PERTURBAÇÕES
→ ADAPTABILIDADE → HIPÓTESES INDIVIDUAIS → ATHLETE STATE SNAPSHOT → AGENTES
```

Não significa esperar terminar tudo pra entregar valor — significa que uma camada não pode ser
construída de um jeito que inviabilize as posteriores.

## 44. Princípio de desempate

*"Essa solução aumenta ou diminui nossa capacidade futura de reconstruir como o sistema daquele
atleta estava, como costumava variar, o que mudou, quando mudou, o que aconteceu ao redor da
mudança, como respondeu e como se reorganizou depois?"* Se aumenta, direção certa. Se comprime tudo
em média/score/estado atual e destrói a trajetória, direção errada.

## 45. O que estamos tentando construir

Não só "a fadiga do aluno hoje é 4" — algo como: *"A fadiga física atual está acima do padrão
recente e histórico. A média curta começou a se deslocar há aproximadamente três semanas,
inicialmente acompanhada por aumento da variabilidade do sono. A variabilidade da fadiga também
aumentou antes de seu nível médio subir. O deslocamento persiste por seis observações. A carga de
treinamento permaneceu relativamente estável nesse período. Próximo ao início da mudança existe um
evento contextual relatado: mudança de emprego com aumento das viagens. Em episódios anteriores de
viagem, há associação temporal semelhante entre piora do sono, aumento da fadiga e redução da
aderência, embora a quantidade de episódios ainda limite a força dessa hipótese. Após perturbações
semelhantes, esse atleta historicamente retornava à faixa habitual em determinado padrão, mas desta
vez o retorno está mais lento. Ainda não sabemos se é um desvio prolongado ou o início de uma
mudança de regime."*

A matemática prepara isso. A IA entende isso. O treinador decide com isso.

---

*Ver também: [`DIRETRIZ_MESTRA_TRAINING_INTELLIGENCE.md`](DIRETRIZ_MESTRA_TRAINING_INTELLIGENCE.md)
(visão geral) e [`GLOSSARIO_METRICAS.md`](GLOSSARIO_METRICAS.md) (definições canônicas já
implementadas no feedback individual v2 e no check-in semanal v3, que alimentam esta camada).*
