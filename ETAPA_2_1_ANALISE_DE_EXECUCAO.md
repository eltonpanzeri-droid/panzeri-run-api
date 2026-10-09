# Etapa 2.1 — Análise determinística da execução (11/10/2026)

> Implementada a partir da ordem de Elton e do mapa técnico do Astra. Sem IA nos relatórios, sem deploy. Código: `apps/api/src/activity-execution/execution-analysis.ts` (matemática pura), `execution-report.ts` (texto), `execution-analysis.service.ts` (persistência/consolidação).

## Comportamentos definidos antes dos testes
| Situação | Comportamento |
|---|---|
| Cenário A (intervalado, intensidade diferente) | alternâncias reconhecidas, tempo nas faixas abaixo do limite → estrutura `intervalado`, cenário A, intensidade `mais_lento`/`mais_rapido`/`misto` |
| B (contínuo no lugar do intervalado) | ≤25% das repetições avaliáveis reconhecidas, sem aceleração final → `continuo`, cenário B |
| C (parcial) | entre 25% e 75% reconhecidas, ou <75% das repetições alcançadas → `parcial`, cenário C (mostra 1ª × 2ª metade) |
| D (contínuo com aceleração final) | sem alternâncias + últimos max(0,5 km; 10%) ≥6% mais rápidos que o corpo, sustentado em ≥70% do trecho → cenário D |
| E (compatível) | alternâncias reconhecidas (≥75%) e ≥60% do tempo dentro das faixas; contínuo: ≥60% na faixa |
| F (dados insuficientes) | cobertura <60%, <2 repetições avaliáveis ou sem blocos por distância → `indeterminado`, nada inventado |
| Corrida interrompida | blocos não alcançados ficam sem dados; conclusão sobre as repetições avaliáveis (parcial), nunca "contínuo" por falta de dados |
| Amostras irregulares / pausas / falha de GPS | percentuais por **tempo de intervalos válidos**; pausa, buraco e distância regressiva ficam fora do denominador e reduzem só a cobertura; parado (<0,5 m/s) também fora |
| Relógio só com resumo | distância, duração, FC média; sem percentuais nem estrutura (texto diz isso) |
| Sem relógio, com feedback manual | só o registro (distância/duração/esforço), rotulado "registro manual" |
| Musculação | duração ±5% (configurável) → próxima/mais curta/mais longa; esforço, FC e kcal só quando existem; nada de séries/repetições/exercícios inferidos |
| Sessão não realizada | `not_done` (marcada como não feita ≠ sem registro); entra na frequência, não na fidelidade |
| Sincronização tardia / duplicada | linha viva recalculada por impressão digital da fonte; uma linha por sessão e versão; atividade duplicada resolvida pela canônica existente; retrato entregue não muda |
| Semana incompleta | indicadores só com o que existe; notas declaram resumo-apenas, manual e sem registro |

## Critérios matemáticos (todos em `EXECUTION_THRESHOLDS`)
- **Intervalo válido:** 0 < dt ≤ max(30 s; 3× dt mediano) e distância não regressiva. Pace por intervalo suavizado numa janela deslizante de 15 s (uma pausa zera a janela).
- **Faixa:** dentro = pace ∈ [rápido−3 s/km; lento+3 s/km]; percentuais = segundos classificados ÷ segundos classificados do bloco. Cobertura declarada (válido ÷ decorrido); bloco com <15 s observados ou cobertura <50% não ganha percentuais.
- **Agregação:** soma de **segundos** (nunca média de percentuais), separada por papel do bloco (estímulo/recuperação/contínuo), cada bloco comparado à própria faixa prescrita.
- **Repetição reconhecida:** pace(recuperação) − pace(estímulo) ≥ max(15 s/km; 50% do contraste prescrito), por bloco inteiro. Aderência de intensidade em intervalados = estímulo + recuperação (aquecimento longo não mascara tiros fora da faixa).
- **Três informações separadas:** atividade/modalidade associada (vínculo existente, intocado), estrutura executada (A–F) e aderência à intensidade.
- **Sem atribuir intenção.** Prescrição por tempo: limitação explícita (sem blocos, sem classificação).

## Relatórios
- **Por treino:** `report.lines` no detalhe da atividade e `sessionReports` no programa (texto condicionado aos indicadores; sem IA).
- **Semanal:** consolidado em `generateWeekLocked` (mesmo ponto, mesma única chamada ao Prescritor). Entra no prompt como `relatorioDeExecucaoDaSemanaAnterior` (só números), é gravado como retrato (`WeeklyExecutionReport`, mesma transação do programa) e aparece no app junto com a nova semana.

## Longitudinal
Quatro variáveis (`execution.distanceCompletionRatio`, `timeInBandPct`, `intervalStructureMatch`, `avgHeartRateInBandBpm`) lidas de `SessionExecutionAnalysis` e incluídas no domínio de carga do Athlete State (janelas 21/60/200 dias). Esforço percebido continua em `workout.perceivedEffort`.

## Privacidade / rastreabilidade
Exclusão de dados do provedor: apaga as linhas de análise derivadas de suas atividades e **invalida** o relatório semanal que as usou; no pacote de evidências o campo sai do texto guardado e o item do índice vira marcador. Exclusão de conta apaga as duas tabelas.

## Limitações concretas
- Validado com séries sintéticas controladas; **não havia séries reais** no repositório (produção não foi acessada). Recomenda-se conferir as primeiras atividades reais.
- Prescrição por tempo não tem alinhamento por bloco (declarado, não resolvido nesta entrega).
- Atividade recebida depois: os indicadores vivos são recalculados ao abrir o treino/a semana (não há gancho na sincronização); o retrato entregue nunca é reescrito.
- Limiares (60%, 75%/25%, 6%, 15 s/km, 3 s/km) são conservadores e documentados, mas não calibrados com dados reais de alunos.
- Cadência/FC por bloco usam a série canônica; sem sensor, o campo fica nulo.
