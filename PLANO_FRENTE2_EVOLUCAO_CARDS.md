# Frente 2 — Evolução como relatório interpretativo (cards que rolam): auditoria e plano (13/11/2026)

> **Estado: AUDITORIA FEITA, plano em lotes. NENHUM código desta frente alterado.** Prioridade máxima de Elton. Regra dele: preservar integralmente os dados da IA; só muda o que a aluna VÊ.

## 1. O que já existe (reaproveitar)
- **Seis áreas** na tela da aluna (`apps/mobile/home/EvolutionHub.tsx`, `EvolutionAreaGrid.tsx`): treinamento, resposta à carga, sono e recuperação, bem-estar, dor, aderência. Seções por área: `EvolutionObjective`, `LoadSection`, `HrDecouplingSection`, `WearableSleepSection`, `FeelingsDetailScreen`, `PainArea`, `AdherenceSection`.
- **Explicação fixa por indicador** (`indicatorMeanings.ts` + `IndicatorMeaning.tsx`): hoje responde "o que mede" e "como interpretar" (texto igual para todas, rascunho de Elton; regras: sem causa direta, sem diagnóstico; rodapé "nenhum indicador é analisado sozinho").
- **Comparações calculadas no servidor** ("uma matemática só"): faixa habitual (canal de tendência, `trendChannel.ts`), aguda × crônica 7×28 (`acute-chronic.ts`), visão global por domínio para a IA (`domain-overview.ts`), leitura de variáveis (`variable-reading-guide.ts`).
- **Dados para a IA** vêm de `athlete-state-snapshot` / `compact-agent-context`: independentes da tela (a tela pode esconder gráficos sem afetar a IA).

## 2. O que falta (pedido de Elton) × o que existe
| Pedido | Hoje | Falta |
|---|---|---|
| Cada indicador: (1) o que mede, (2) como interpretar | SIM (`indicatorMeanings.ts`) | — |
| (3) comportamento HABITUAL da aluna | parcial: faixa/canal no gráfico, números no servidor | frase pronta "sua média habitual de longo prazo é X" por indicador |
| (4) o que a TENDÊNCIA ATUAL sugere | só rótulo neutro de 7×28 em alguns | frase por indicador, respeitando a escala real (ex.: sono 1–5) e SEM causalidade |
| Síntese por GRUPO ("10 de 12 compatíveis…") | não existe | contagem de indicadores melhorando/estáveis/piorando por área + texto |
| Agrupar por 5 áreas (recuperação, resposta à carga, desempenho, consistência, comportamento) | 6 áreas atuais (treinamento, carga, sono, bem-estar, dor, aderência) | mapear as 6 atuais nas 5 de Elton (ou manter 6; DECISÃO) |
| Eliminar gráficos redundantes na tela | — | lista de quais (DECISÃO de Elton com a lista) |
| Cards que rolam para os lados | não existe (grade/listas verticais) | carrossel horizontal por área |

## 3. Decisões que dependem de Elton
1. **Cinco áreas (as dele) ou as seis atuais?** (Sugestão: manter a navegação atual e só reagrupar o texto de síntese.)
2. **Texto "habitual" e "tendência" = texto FIXO montado por regra (como `indicatorMeanings`) ou escrito pela IA?** Recomendo **regra + modelo de frase** (previsível, sem custo, sem risco de a IA inventar causa); IA só se ele quiser tom mais humano, e nesse caso o texto passa por schema/guardrails como proposta.
3. **Peso dos indicadores na síntese:** contar todos igual é o que ele mesmo disse que NÃO quer ("sem o mesmo peso"). Preciso da lista de quais indicadores contam em cada grupo e quais pesam mais, ou começamos só com contagem simples dos válidos e marcamos "versão inicial".
4. **Quais gráficos saem** da tela da aluna (a IA continua com todos os dados).

## 4. Lotes (cada um reversível; PWA no Deploy do app, nativo no build)
- **Lote 1 — API:** classificar cada indicador como melhor/estável/pior comparando a tendência recente com o habitual (a mesma faixa que o gráfico já usa), por área, devolvendo contagens e as frases ("habitual" e "tendência") em UM endpoint novo (`GET /me/evolution/summary`). Só indicadores com dado suficiente e escala conhecida. Testes com séries sintéticas e guarda de "sem causalidade".
- **Lote 2 — App:** carrossel horizontal de cards por área (card de síntese primeiro; indicador depois; o seguinte aparece cortado na borda; bolinhas de posição; toque abre o detalhe/gráfico atual). Reaproveita os componentes de seção.
- **Lote 3 — App:** cada card traz as 4 informações (o que mede, como interpretar, habitual, tendência).
- **Lote 4 — limpeza:** esconder os gráficos redundantes aprovados por Elton.
- **Lote 5 — texto/IA:** (se decidido) tom; nada muda nos dados da IA.
- **Riscos:** saúde (dor/sono): sem diagnóstico; texto com escala errada; síntese com poucos dados (mostrar "dados insuficientes"); carrossel no Android/iOS/PWA (gesto, acessibilidade).
