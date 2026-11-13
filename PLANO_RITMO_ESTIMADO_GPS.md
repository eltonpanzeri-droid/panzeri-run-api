# Ritmo estimado pelo GPS — plano (13/11/2026)

> **Estado: IMPLEMENTADO em 13/11/2026 (Lotes 1 a 5), commitado, NÃO validado ao vivo.** (Plano original abaixo; ver a seção "Implementação" no fim.) Decisões dele: (1) vale para TODAS as alunas (regra geral, nunca para uma aluna); (2) só aparece quando o relógio NÃO entregou a série de ritmo; (3) serve para o gráfico de ritmo e para o texto/percentual de quanto ficou dentro da faixa prescrita; (4) avisar a aluna (gráfico/texto) e a IA de que é estimado e menos preciso; (5) **o resultado da faixa continua em PERCENTUAL** (decisão dele); (6) NUNCA conta para recordes pessoais.

## Texto informativo (rascunho para Elton aprovar)
> **Ritmo estimado.** O seu relógio não entregou o ritmo ao longo do treino, então nós o calculamos de forma indireta, pelo percurso de GPS. Esse cálculo pode apresentar mais erros do que a medição do relógio. Por isso ele aparece só como referência no gráfico e na análise da faixa, e **não é usado para contabilizar recordes pessoais**.

Aviso à IA (texto curto no contexto da análise): "ritmo estimado pelo GPS (o relógio não entregou a série); menos preciso que a medição; não usar para decisões finas nem recordes".

## Auditoria (quem lê ritmo hoje)
- `activity-execution/activity-detail.service.ts` e `activity-chart.ts`: série por balde para o gráfico (lê `speedKmh`, `distanceMeters`, `heartRateBpm`, `cadenceSpm` de `ActivityTimeSeriesPoint`).
- `activity-execution/execution-analysis.service.ts`: relatório pós-treino (tempo dentro da faixa, prescrito × realizado por bloco); resultado persistido (`SessionExecutionAnalysis`, `WeeklyExecutionReport`) e usado pelo contexto da IA.
- `best-marks/best-marks.service.ts` (recordes), `training-intelligence/hr-decoupling*.ts` (precisa de FC), carga e demais indicadores: leem a coluna `speedKmh`/`distanceMeters`.
- Percurso (GPS) já guardado como linhas com latitude/longitude em `ActivityTimeSeriesPoint` (Apple Saúde e Health Connect; os outros provedores já trazem a série).

## Decisão de desenho (recomendada): CALCULAR NA LEITURA, NÃO GUARDAR
O ritmo estimado NÃO é gravado na coluna de velocidade. Ele é calculado em memória, a partir das linhas de percurso, só pelo caminho que desenha o gráfico e pela análise da faixa. Vantagens: (a) recordes, desacoplamento da FC, carga e qualquer outro consumidor continuam lendo só o dado MEDIDO (a exclusão dos recordes vale por construção, não por lembrança de filtro); (b) sem migração; (c) quando a série real chegar, o estimado simplesmente deixa de ser usado, sem limpeza; (d) uma única função de cálculo ("uma matemática só").

## Lotes (pequenos, reversíveis)
- **Lote 1 — cálculo puro (API, sem efeito visível):** `gps-derived-pace.ts`: de pontos (segundo, lat, lon) a ritmo por segundo (distância entre pontos ÷ tempo, descartar saltos impossíveis e lacunas de pausa, suavização com janela fixa, exigir cobertura mínima do treino). Testes com trilhas sintéticas (ritmo constante, ruído, parada, pausa, volta). Rollback: apagar o arquivo.
- **Lote 2 — leitura (API):** gráfico e análise da faixa usam a série medida se existir; senão, a estimada, devolvendo `paceSource: 'measured' | 'gps_estimated'`. O percentual dentro da faixa continua exato (regra existente), calculado sobre a série usada, com o rótulo da origem. Opt-in do cliente (`?pace=estimated`) para os apps antigos nunca verem ritmo estimado SEM o aviso.
- **Lote 3 — travas e testes de guarda:** recordes, desacoplamento, carga e agregados NÃO recebem o estimado (teste que prova que nada de estimado é gravado nem lido por eles).
- **Lote 4 — IA:** `paceSource` e a frase de aviso entram na análise persistida e no contexto da IA.
- **Lote 5 — telas:** gráfico com linha tracejada e o texto informativo acima; texto da faixa com o aviso. PWA no Deploy do app; nativos só no próximo build (por isso o opt-in do Lote 2: app antigo não pede e não vê).

## Riscos
- Ruído do GPS perto dos limites da faixa pode mover o percentual (aceito por Elton: segue percentual, com o aviso de menor precisão).
- Não ajuda treino sem GPS (esteira, ambiente fechado) nem FC/cadência/potência.
- Provedores com série própria (Polar, Garmin, COROS, Zepp, Wahoo) não são afetados.

## Implementação (13/11/2026)
- Lote 1: `apps/api/src/activity-execution/gps-estimated-pace.ts` (função pura; calibra a distância com o total medido quando concorda em até 25%, senão recusa; salto > 12 m/s não soma; lacuna > 15 s não interpola; janela de ±5 s; mínimo 20 pontos e 60 s). OBS: o ritmo estimado vem junto de uma DISTÂNCIA ACUMULADA estimada (a análise por bloco usa a distância para achar onde começa cada bloco), calibrada com a distância medida do resumo.
- Lotes 2-4: `run-points-loader.ts` (medido sempre vence; estimado só sem distância/ritmo medidos e com percurso), `activity-detail.service.ts` (gráfico/parciais só para quem pede `?pace=estimated`), `execution-analysis.service.ts` (a análise usa o estimado, grava `paceSource` e o aviso da IA em `limitations`; impressão digital inclui o modo estimado), `execution-report.ts` (texto da aluna). Nada é gravado em ActivityTimeSeriesPoint; recordes e desacoplamento da FC não importam o estimador (teste de guarda).
- Lote 5: `apps/mobile/src/activityDetail.tsx` (linha tracejada, legenda e texto) e `App.tsx` (pede `?pace=estimated`). PWA no Deploy do app; nativos só no próximo build; app antigo não vê gráfico estimado (mas vê o percentual e o aviso no texto do relatório).
- Testes: `gps-estimated-pace.spec.ts` (6), `estimated-pace-integration.spec.ts` (9); 57 suítes de detalhe/análise/App verdes.
