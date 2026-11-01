# Carga interna percebida — documentação técnica (01/11/2026)

Pedido de Elton em 01/11/2026. Escopo entregue: **painel do administrador + agentes de IA** (a tela do aluno no app ficou para depois, por decisão dele). Nada de build, deploy ou envio às lojas foi feito.

## 1. O que é
- **Carga interna percebida (UA) = PSE da sessão (1 a 10) × duração efetiva em minutos.**
- Três variáveis **distintas e preservadas**: `workout.perceivedEffort` (PSE), `workout.sessionDurationUsedMin` (duração usada) e `workout.sessionInternalLoad` (carga em UA). A carga nunca substitui a PSE.
- É descritiva. Não há faixa de "bom/ruim/seguro/perigoso" e a razão aguda/crônica não é diagnóstico de risco, fadiga ou prontidão.

## 2. Fonte única do cálculo
- `apps/api/src/coach/training-load-rows.ts` → `loadInputRows()` monta os registros (treino feito, PSE, duração, atividade vinculada). Regras herdadas do cálculo de 23/10: vínculo ativo, observação canônica (sem duplicar eventos físicos), a mesma atividade nunca serve a dois treinos, vínculo automático a mais de 3 dias ignorado (6 se confirmado por pessoa), nunca Strava.
- `apps/api/src/coach/training-load.ts` → `classifySessions()` decide quem entra (PSE 1–10 e duração utilizável; nada é estimado) e quem fica de fora **com motivo**; `windowAt()` calcula aguda/crônica/razão; `compareSessionToReference()` junta a sessão ao seu ponto de referência.
- Consumidores (todos leem a mesma fonte): painel (`student-training-load.service.ts`), Explorar (`observation-reader.service.ts`, fonte `internal_load_session`) e IA (`athlete-state-snapshot.service.ts` → `internal-load-context.ts`).
- Duração: com atividade importada corretamente vinculada vale a duração dela; senão a informada pela aluna; senão a sessão fica de fora. Correções de PSE, duração ou vínculo recalculam tudo na próxima leitura (nada é guardado em cópia).

## 3. Comparação da sessão com o histórico (a sessão fica FORA das próprias referências)
- Reutiliza `reference-series.ts` (`prior_observations_only`), a mesma metodologia dos demais indicadores da Evolução:
  - média histórica = todas as sessões elegíveis **anteriores da mesma modalidade**;
  - médias móveis das últimas 7, 21, 60 e 200 sessões anteriores (janela por contagem de sessões);
  - faixa habitual = percentis 10–90 das anteriores (até 200); ≥12 anteriores = individual; 4–11 = limitada; <4 = **sem faixa** (nunca tratada como "normal");
  - sessões no mesmo instante e modalidade compartilham a referência (nenhuma entra na da outra); dados futuros nunca são usados.
- Sinal: acima / dentro / abaixo da faixa individual — neutro, sem julgamento.
- Modalidade: chave canônica (`loadModalityKey`); corrida só com corrida, musculação só com musculação, demais com referências próprias. A visão agregada é identificada como soma.

## 4. Carga acumulada (janelas móveis)
- Aguda = soma das cargas dos últimos 7 dias. Crônica = soma dos últimos 28 dias ÷ 4. Razão = aguda ÷ crônica.
- Regra de Elton (23/10): a razão só existe com 28 dias de histórico **e** ≥10 treinos nos 28 dias; senão `null` com explicação. Denominador nulo → sem razão.
- A sessão mais recente entra normalmente nas janelas; as janelas não dependem do fim da semana do calendário.
- `training.acwr` (já existente) é outra métrica: razão de **volume em km** (28 ÷ 42 dias). Os textos do registro e da IA deixam isso explícito.

## 5. Como a IA recebe e usa
- Variável `workout.sessionInternalLoad` no pool do Athlete State (com `byModality`, tendência, baseline, faixa, excursão).
- Bloco `cargaInternaPercebida` no contexto compacto (agente de prescrição) e no Agente de Evolução: por modalidade, última sessão (PSE, duração, origem da duração, carga, referências anteriores, faixa, posição, diferenças), últimas 6 sessões, carga semanal, carga acumulada; agregado geral identificado; qualidade dos dados.
- Prompt: bloco nomeado `INTERNAL_LOAD_INSTRUCTION` (prescrição semanal) e bullet no Agente de Evolução. Regras: carga ≠ emoção negativa, ≠ recuperação insuficiente, ≠ risco comprovado; carga baixa ≠ prontidão; nenhuma regra automática; combinar com sono, dor, fadiga, FC, motivação, satisfação e superação; admitir limitação quando as evidências divergem.
- **Consentimento**: dentro do escopo de IA, atividade de relógio/provedor sem consentimento é tratada como inexistente (duração e data voltam às informadas/programadas); sessão extra criada só por atividade de provedor bloqueado não entra; Strava nunca entra.
- Mesmo corte de histórico contaminado por teste das demais variáveis (`training-history-policy.ts`).

## 6. Painel
- Evolução → Explorar → Treinos reorganizado em 5 grupos (Volume e consistência; Esforço percebido e carga interna; Intensidade e resposta cardiovascular; Mecânica e eficiência da corrida; Execução e experiência do treinamento). Cada indicador em um só grupo; busca global mantida; estrutura expansível (`explorer-catalog.ts`).
- "Carga acumulada e semanas" (grupo Esforço) tem três visões: **Sessões** (principal, com gráfico de barras + média móvel + faixa habitual), **Carga acumulada** (7 e 28 dias e razão) e **Semanas**.
- A antiga aba "Carga (própria)" foi consolidada aqui (uma só implementação). A razão aguda:crônica de **volume (km)** ficou junto do Volume.

## 7. Limitações reais
- A tela do aluno no app não foi feita (decisão de Elton).
- A resposta da IA aos cenários interpretativos (A a D) não é reproduzível sem chamar o modelo: os testes provam que o contexto e as regras chegam à IA, não o texto que ela escreve.
- O bloco novo soma ~3 a 7 mil caracteres ao contexto; o teto é 45 mil (`AI_CONTEXT_MAX_CHARS`). Acima dele, saem os dados de relógio (nunca a carga) e o treinador é avisado. Se alunas com muitos dados passarem do teto, subir a variável.
- Sem histórico (<4 sessões na modalidade) não há faixa; a interface e a IA dizem isso.
- Revisão independente (contexto separado) recomendada antes de sincronizar: toca prescrição, IA e dados de treino.
