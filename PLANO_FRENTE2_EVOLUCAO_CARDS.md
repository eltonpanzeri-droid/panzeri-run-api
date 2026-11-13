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

## 5. DECISÕES DE ELTON (13/11/2026) e implementação (Lotes 1 a 3 feitos, não validados ao vivo)
- **Seis áreas; texto por REGRA (sem IA); NENHUM gráfico removido por enquanto.** Cada indicador diz: o que a escala significa (ex.: "números mais perto de 5 = você tende a dormir bem"), por que importa, a média da aluna, a tendência de curto e de longo prazo, e o que isso indica; cada área ganha uma síntese ("nesse quesito, X dos N indicadores apresentam melhora ou padrão bom…") com o que isso significa.
- **API:** `GET /me/evolution/summary` (`evolution-reading-catalog.ts` = textos e polaridade por indicador, rascunho a revisar por Elton; `evolution-summary.ts` = regras puras; `evolution-summary.service.ts`; `coach/me-evolution-summary.controller.ts`). Escala vem do VariableRegistry; médias e janelas da camada matemática existente (aguda 7 × crônica 28; longo prazo = crônica × tudo antes dela). Só registros desde 01/08/2026; menos de 8 registros = "dados insuficientes".
- **Regras (rascunho):** nível pela posição na escala (>= 75% do lado bom = bom; <= 37,5% = ruim; 1–5: 4 é bom, 2,5 é ruim); mudança só conta acima de 10% da escala; indicador sem polaridade (esforço, volume, ritmo) nunca vira melhora/piora e fica fora da contagem. Bucket: nível ruim = atenção; nível bom = bom (estável se piorando); intermediário decide pela tendência de curto prazo.
- **App:** `home/EvolutionReadingCards.tsx` (carrossel horizontal, card de resumo primeiro, próximo card cortado na borda, bolinhas) inserido nas áreas treinamento, aderência, carga, sono e bem-estar do `EvolutionHub`. Dor mantém a tela própria. PWA no Deploy; nativos no próximo build.
- **Fora desta etapa:** indicadores medidos por relógio (sono, HRV, FC de repouso: precisam de lógica por fonte), gráficos a esconder (Elton: ainda não), texto de "tendência" com IA (não).
- **Testes:** `evolution-summary.spec.ts` (13), `evolution-cards-app.spec.ts` (2); 20 suítes de Evolução/App verdes; `tsc` verde (API e app).

## 6. REGRAS DE ELTON PARA ESFORÇO, VOLUME, RITMO E RELÓGIO (14/11/2026) — implementado, rascunho a revisar
- **Esforço percebido:** texto pela posição da média na escala. Alto: "pode indicar boa tolerância, mas também intensidade sempre muito forte, risco de lesões e abandono"; iniciantes percebem mais esforço (no "o que mede"). Médio e baixo: textos-rascunho meus (Elton só deu o alto). Nunca "bom/ruim".
- **Volume:** padrão de longo prazo em km/semana, última semana observável contra o padrão, tendência recente ("aumento/redução do volume"), nota "mais km tende a dar melhores resultados, mas mais risco de lesões e sobrecarga"; NÃO qualifica. A semana em curso fica fora. Mudança conta 10% do próprio valor (não da escala do registro). App: bloco com 3 gráficos fixos (prescrito, realizado, prescrito × realizado) em App.tsx/Progress; o gráfico com caixas de seleção continua.
- **Ritmo:** só métrica e tendência com as palavras "ritmo médio mais rápido/mais lento"; nota de que ficar mais rápido é natural, principalmente no longo prazo; sem avaliar capacidade. Ritmo estimado pelo GPS nunca entra nesta série (é calculado só na leitura).
- **Relógio (área Sono e recuperação):** tempo total de sono, sono profundo, REM, HRV da noite e FC de repouso entram como indicadores ACOMPANHADOS (sem bom/ruim), tendência em "aumento/queda", texto "cada dado é parte de um todo... não é diagnóstico". Só a fonte principal da aluna (chooseMainSource, sem preferência explícita ainda) e só a sessão principal da noite.
- **Ainda não:** número de ciclos de sono (o relógio não envia), pontuação do sono, sono leve/acordado. Preferência explícita de fonte (AthletePrimarySource) não é lida aqui.
- Arquivos: evolution-reading-catalog.ts, evolution-summary.ts, evolution-summary.service.ts (mainSourceOnly), App.tsx; testes em evolution-summary.spec.ts (+5).

## 7. Ritmo: relógio + preenchido, sem impossível, com aviso (14/11/2026, decisão de Elton)
- **Regra:** relógio que entrega tudo = usa; relógio só com distância e tempo = ritmo médio é distância ÷ tempo (já era assim; não precisa de GPS); aluna sem relógio = usa o preenchido (tempo ÷ distância). O ritmo estimado por GPS continua só no gráfico de dentro do treino.
- **Entra só na leitura da Evolução** (`getManualPaceObservations` + `EvolutionSummaryService`); a série `activity.avgPaceSecondsKm` que a IA lê NÃO mudou. Preenchido só conta se a sessão é corrida (esteira = corrida), `source='manual'` e sem atividade do relógio vinculada (evita contar duas vezes).
- **Ritmo impossível** = fora dos limites do registro (120 a 1200 s/km, 2:00 a 20:00): fica fora da média; a frase da aluna conta "N do relógio, M preenchidos, K de fora por ritmo impossível". Recordes continuam só com ritmo medido.
- **Aviso:** ao salvar o feedback, ritmo impossível gera "Você confirma esse dado?" (sino + push), ação abre o feedback do treino, uma vez por combinação distância/tempo. Valor nunca é alterado nem recusado.
- Limitação conhecida: preenchido em sessão cujo ActivityLog existe mas não está vinculado não é deduplicado. Ao entrar o orquestrador de notificações (teto 5/dia), este aviso deve passar por ele.
- Arquivos: pace-plausibility.ts, observation-reader.service.ts, evolution-summary(.service).ts, workout-completions.service/module; testes pace-provenance.spec.ts (9).
