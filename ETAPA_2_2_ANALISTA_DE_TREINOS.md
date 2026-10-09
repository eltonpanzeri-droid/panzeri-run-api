# Etapa 2.2 — Analista de Treinos

**Natureza:** camada determinística (zero chamadas de IA) que interpreta treino, semana e evolução relacionando prescrito × executado × esperado × histórico. Não prescreve, não escolhe progressão, não altera planejamento.

## Como funciona
- **Treino individual** (`analyzeSessionInContext`): reconhece o estímulo realmente executado (assinatura de esforços: nº de repetições, distância/ritmo por repetição, volume rápido, recuperação passiva/ativa, regularidade), compara com a prescrição e a intenção (1.2b). Não presume tentativa e falha. Atividades sem prescrição (iniciativa do aluno) são analisadas.
- **Semana** (`analyzeWeekInContext`): adesão, volume, distribuição nas faixas, fidelidade, volume rápido, extras, esforço/dor/comportamento relatados, comparação com semanas anteriores, indicadores fora da faixa habitual; coocorrências ficam rotuladas como não causais.
- **Evolução** (`analyzeLongitudinal`): famílias de intervalados por distância de repetição, formatos recorrentes (≥3 sessões), melhores marcas recentes (21 d) × históricas, mudanças variável a variável entre sessões semelhantes (distância por repetição, nº de repetições, velocidade, volume rápido, recuperação, regularidade) sem dizer qual mudar; tendências MA21/60/200 reutilizando `getVariableSnapshot` (sem cálculo duplicado).
- **Feedbacks:** entram como *relatado* (esforço, comportamento declarado, motivos de ajuste, dor, presença de texto livre). Separação em medido / relatado / interpretação técnica / lacuna; motivo não informado vira lacuna, nunca explicação inventada.

## Contrato (`training-analysis/1`, tabela `TrainingAnalysis`)
`scope` (session|week|longitudinal), `facts`, `reported`, `findings` (código, tipo, suporte alta/média/baixa, horizonte pontual/recente/consolidado, base), `gaps`, `capabilities`, `changes`, `evidence` (ids, provedores, janelas, limitações, `madeWithoutAI`). Sessão: linha viva (recalculada). Semana/evolução: retrato congelado entregue com o programa (`deliveredWithPlanId`); dado tardio não altera o retrato. Leitura: `GET /coach/students/:id/training-analysis`.

## Integração
Dentro de `generateWeekLocked`, antes da chamada única ao Prescritor; seleção enxuta vai no campo `analiseTecnicaDoAnalistaDeTreinos` do prompt (+ `ANALYST_EVIDENCE_INSTRUCTION`). Rastreabilidade: item `training_analysis` no pacote de evidências; exclusão de dados do provedor apaga linhas vivas, invalida retratos e anula o campo no texto guardado; exclusão de conta inclui a tabela. Falha do Analista vira ContextGap informativo e não bloqueia a geração.

## Custo de IA
**Chamadas adicionais: 0.** Impacto: ≈ +700–900 tokens de entrada por geração semanal (limite testado < 6000 caracteres). A ser confirmado com consumo real. Um Analista baseado em LLM exigiria chamada separada: só com necessidade e impacto apresentados antes.

## Limitações
Classificações validadas só em séries sintéticas (limiares 0,92×ritmo típico, ≥20 s/100 m, suavização 8 s não calibrados com dados reais; curtos subestimados poucos %); detecção de recuperação assume sinais de parada/caminhada; leitura de texto livre fica com Relator/Prescritor; backfill limitado a 30 sessões por geração; atividades de força por iniciativa do aluno não analisadas; comparações dependem de dados 1.2b presentes; não explica motivos (por desenho).
