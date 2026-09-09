# Evolução do Atleta V1 — Contrato de Métricas

**Status:** active  
**Criado em:** 2026-09-09  
**Baseado em:** Censo de cobertura de dados (09/09/2026) + ARQUITETURA_EVOLUCAO_ATLETA_PANZERI_RUN.md  
**Tipos TypeScript:** `apps/api/src/evolution/evolution.types.ts`

---

## Contexto do censo

O banco de produção em 09/09/2026 tem:

| Dado | Quantidade | Avaliação |
|------|-----------|-----------|
| Sessões prescritas | 2.778 | Base sólida |
| Com completion | 609 (22%) | Baixo, mas crescendo |
| Sem registro | 2.169 (78%) | Realidade atual |
| Feitas (done+adjusted) | 479 | Dado confiável |
| Não feitas (missed) | 130 | Dado confiável |
| WeeklyCheckIn | 23 | Insuficiente para V1 |
| PainReport | 14 | Insuficiente para V1 |
| FitnessTest | 30 | Insuficiente para V1 |
| Strava activities | 630 | Potencial futuro |

A cobertura real (meses maduros ago–set/26) é ~40%, não 22%.  
O sistema lançou em junho/26.

---

## Regras fundamentais (imutáveis no V1)

### 1. Aderência
```
adherencePercent = feitas / (feitas + naoFeitas)
```
- **Sem registro NÃO entra no denominador.** Nunca.
- Retorna `null` quando não há nenhum feedback qualitativo (denominador = 0).
- Exibir como `—` na UI quando null, jamais como 0%.

### 2. Cobertura (transparência)
```
coveragePercent = (feitas + naoFeitas) / sessoesPrescritas
```
- Sempre exibida junto com aderência, nunca separada.
- Quando `coveragePercent < 30%`: exibir aviso `"Poucos treinos registrados — aderência calculada sobre amostra pequena"`.

### 3. Sem registro
```
sessoesSemRegistro = sessoesPrescritas − sessoesFeitas − sessoesNaoFeitas
```
- Exibido explicitamente na tela como gatilho de comportamento.
- Nunca computado como "feito" nem como "não feito".

### 4. Timezone
- Todas as datas comparadas em UTC-3 (Brasil).
- "Hoje" = `new Date(Date.now() - 3*60*60*1000).toISOString().slice(0, 10)`.
- Sessão é "sem registro" apenas quando `scheduledDate < hoje`.

### 5. Sem IA
- Todas as métricas são cálculos determinísticos.
- Zero chamadas de LLM no `EvolutionMetricService`.

---

## Métricas incluídas no V1

### Volume semanal
- Sessões prescritas por semana (100% de cobertura).
- Sessões feitas / não feitas / sem registro por semana.
- Semanas com pelo menos 1 registro ("semanas ativas").

### Aderência
- All-time, últimas 4 semanas, últimas 8 semanas.
- Sempre com `coveragePercent` e aviso quando baixo.

### Streak de consistência
- Semanas consecutivas com ao menos 1 feedback (feita ou não feita).
- Streak atual e maior streak histórico.

### Distribuição de modalidade
- Corrida (44% das sessões prescritas).
- Fortalecimento (35%).
- Força (18%).
- Esteira (3%).
- Percentual de cada modalidade sobre o total prescrito.

### Sem registro acumulado
- Contador total para o aluno.
- Usado como gatilho comportamental na tela.

---

## Métricas adiadas para V2

| Métrica | Motivo do adiamento |
|---------|---------------------|
| Tendência de RPE | Poucos registros (~233 para corrida, zero para força em V1) |
| Pace/ritmo por sessão | Campo não existe no schema atual |
| Check-in semanal | 23 registros totais — sem massa |
| Relatório de dor | 14 registros totais — sem massa |
| Teste de fitness | 30 registros; entrada escondida da UI |
| Integração Strava | 630 atividades; precisa checar vínculo com sessões |

---

## Endpoints planejados

| Endpoint | Retorna | Status |
|----------|---------|--------|
| `GET /me/evolution/overview` | `EvolutionOverview` | Pendente (Step 5) |
| `GET /me/evolution/series` | `EvolutionSeries` | Pendente (Step 5) |

---

## Alunos com dados suficientes para testar V1

Baseado no censo, estes alunos têm cobertura >40% e volume razoável:

| Cód | Sessões | Coverage | Obs |
|-----|---------|----------|-----|
| 22 | 96 | 67% | Melhor engajamento |
| 38 | 74 | 70% | Excelente |
| 32 | 63 | 54% | Bom |
| 30 | 64 | 52% | Bom |
| 14 | 107 | 39% | Volume alto |

---

## Alunos com card amarelo esperado

Estes têm muitas sessões sem registro e devem ver o aviso prominente:

| Cód | Sessões | Sem registro | % sem reg |
|-----|---------|--------------|-----------|
| 1 | 129 | 129 | 100% |
| 23 | 90 | 89 | 99% |
| 3 | 268 | 243 | 91% |
| 15 | 129 | 115 | 89% |

---

## Próximos passos (aguardando autorização por etapa)

- **Step 3:** Schema — nenhuma migration necessária para V1 (todos os dados já existem). Apenas índices de performance para as queries de evolução. **PARAR antes de rodar migration.**
- **Step 4:** `EvolutionMetricService` — implementação dos cálculos.
- **Step 5:** Controllers + endpoints REST.
- **Step 6–7:** Tela mobile com react-native-svg.
