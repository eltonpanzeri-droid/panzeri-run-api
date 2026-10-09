# PROPOSTA TÉCNICA (não implementada) — `weekly_training_load` na exclusão de dados de um provedor

> Data: 10/10/2026 · Status: **proposta para revisão do Astra. Nada foi implementado.** Deploy proibido; 1.2b e Etapa 2 não iniciadas.
> Regra de Elton (a aplicar): (1) preservar o que vem das prescrições e dos registros independentes do aluno; (2) excluir/invalidar o que deriva de dados de um provedor quando há pedido explícito de exclusão; (3) se um agregado mistura origens e a contribuição do provedor não pode ser separada, **invalidar o agregado na trilha**, deixando marcador auditável sem os valores; (4) **nunca alterar retroativamente os treinos prescritos**.

## 1. Fatos (verificados no código)
- São 8 variáveis com `source: 'weekly_training_load'` (`variable-registry.ts`): `training.volumePrescribedKm`, `volumeCompletedTotalKm`, `volumeCompletedPrescribedOnlyKm`, `volumeExtraKm`, `volumeDiffAbsoluteKm`, `volumeRatioCompletedPrescribed`, `adherencePercent`, `acwr`.
- Elas são calculadas por semana a partir de **sessões e registros** (`TrainingSession`, `WorkoutCompletion`), não de `ActivityLog` direto (`observation-reader.service.ts`). Sessões extras são identificadas por `structure.source='student' && type='extra'`.
- Atividades de dispositivo entram nesses números por **materialização**: uma atividade do relógio vira sessão `device_extra` com registro (`SessionExecutionLink.materializeExtraActivity`) e passa a contar como volume realizado/extra. A exclusão de dados do provedor (já existente) apaga essas sessões sintéticas, ou, se o aluno as enriqueceu, mantém a sessão e anula só os valores copiados do relógio.
- O que a 1.2a implementou: remove só as variáveis `activity_objective` (`activity.avgPaceSecondsKm`, `activity.cadenceAvg`) dos pacotes. As 8 de carga semanal **não** são tocadas.

## 2. Classificação proposta (INFERÊNCIA a confirmar pelo Astra)
| Variável | Origem | Pode conter contribuição de provedor? |
|---|---|---|
| `volumePrescribedKm` | somente prescrição (`TrainingSession` de programa) | **Não** — preservar sempre |
| `adherencePercent` | prescrito × registrado pelo aluno (sessões do programa) | **Não**, salvo registro cujo valor foi copiado do relógio e não editado (ver 3.3) |
| `volumeCompletedPrescribedOnlyKm` | registros de sessões do programa | Parcial: valor do registro pode ser cópia do relógio (vínculo/atividade) |
| `volumeExtraKm` | sessões extras | **Sim** (extras `device_extra` vêm do relógio) |
| `volumeCompletedTotalKm` | prescritas + extras | **Sim** (mistura) |
| `volumeDiffAbsoluteKm`, `volumeRatioCompletedPrescribed` | derivadas de completado × prescrito | **Sim** (herdam) |
| `acwr` | carga aguda/crônica sobre o volume realizado | **Sim** (herda, janela longa) |

## 3. Proposta
### 3.1 Registrar proveniência por agregado na geração (deterministico, sem IA)
No `buildEvidenceIndex`, para cada variável `weekly_training_load` com n>0, gravar `contributions`: contagem de observações por origem — `prescribed`, `student_record`, `device_materialized` (com lista de provedores), `unknown`. Derivado do `context` das observações já lidas (sessionId → origem da sessão; para `device_extra`, o provedor está em `structure.provider`; vínculo ativo `SessionExecutionLink` → `ActivityLog.provider` para registros copiados). Sem fórmula de treino: só **contagem de origem**.
Nova coluna aditiva em `PrescriptionEvidencePackage`? **Não é necessária**: `evidence` é JSON e o item já tem `providers`; basta preencher `providers` e `contributions` (migration zero).

### 3.2 Regras na exclusão explícita do provedor P
Para cada variável de carga semanal do pacote:
1. `providers` não inclui P → **preservar**.
2. Só `prescribed` (`volumePrescribedKm`) → **preservar** sempre (regra 1 de Elton).
3. Contribuição de P **separável** (a origem de cada observação é conhecida e a variável é soma simples, ex.: `volumeExtraKm`) → **invalidar** mesmo assim na 1ª versão da regra (não recalcular: recalcular seria fórmula nova sobre o histórico; ver decisão aberta D1).
4. Mistura com P **não separável** (`volumeCompletedTotalKm`, `volumeDiffAbsoluteKm`, `volumeRatioCompletedPrescribed`, `acwr`, `volumeCompletedPrescribedOnlyKm` quando há cópia de relógio) → **invalidar o agregado**: remover do índice (marcador `redacted`) e do texto enviado à IA (variável + legenda + referências + aviso de comparabilidade), exatamente como já feito para `activity.*`.
5. Proveniência desconhecida (pacote antigo) → tratar como "pode conter" **só para as variáveis da tabela com "Sim/Parcial"**, nunca `volumePrescribedKm` nem `adherencePercent`.
6. Marcador auditável (já existente em `agentInputRedactions`): provedor, instante, ids das variáveis invalidadas, motivo `mixed_origin_not_separable` ou `provider_derived`. Nunca valores.

### 3.3 Preservação (o que NÃO muda)
- `TrainingSession` de programa e suas decisões/versões na trilha: **não são tocadas** (regra 4). Nenhum recálculo retroativo de prescrição.
- Registros do aluno (`WorkoutCompletion`) e a exclusão já existente de dados do provedor no domínio vivo: inalterados.
- `volumePrescribedKm` e `adherencePercent` permanecem no prompt guardado.

### 3.4 Efeito no prompt guardado
Variáveis invalidadas somem do texto guardado; o restante do prompt permanece. Registro explícito de que **o texto original enviado à IA continha o agregado** fica só como hash + marcador (como hoje).

## 4. Testes propostos (integração, PostgreSQL isolado, pacotes realistas)
- Pacote com as 8 variáveis, aluno com extras `device_extra` do provedor P e do provedor Q, registro editado e registro copiado: excluir P → `volumePrescribedKm` e `adherencePercent` intactos; mistas invalidadas; Q preservado onde separável (D1); marcador sem valores; zero vazamento dos valores sentinela no pacote.
- Pacote sem proveniência (legado); pacote já expurgado pela retenção; idempotência; outro aluno intacto; desconexão não toca a trilha.
- Garantia de não retroatividade: hash do `TrainingSession.structure` de sessões prescritas e dos `sessionSnapshot` das decisões idêntico antes e depois.
- Unitário da contagem de origem (`contributions`) com sessões prescritas, extras de aluno, `device_extra` e cópia de relógio.

## 5. Riscos
- **Classificação errada de origem** (ex.: registro cujo valor foi copiado do relógio e depois editado). Mitigação: usar a mesma comparação tolerante da exclusão viva (`classifyMaterializedCompletion`) como fonte da verdade.
- **Invalidar demais** reduz o contexto reconstruível do pacote antigo (aceito pela regra 3 de Elton; o marcador diz o que saiu).
- **Custo**: leitura extra de vínculos na geração (somente SELECT, dentro do limite atual da transação).
- Reversibilidade: sem migration; reverter = remover a regra e o preenchimento de `contributions`.

## 6. Decisões abertas para o Astra / Elton
- **D1:** quando a contribuição é separável (ex.: `volumeExtraKm`), **invalidar** (simples, sem fórmula) ou **recalcular sem P**? Recomendação: invalidar.
- **D2:** `volumeCompletedPrescribedOnlyKm` e `adherencePercent` com valor copiado do relógio e não editado: tratar como derivado de P?
- **D3:** `acwr` usa janela de semanas: invalidar sempre que qualquer semana da janela tenha contribuição de P?
- **D4:** aviso ao aluno, na exclusão, de que agregados históricos guardados serão invalidados (texto legal; ver rascunho legal, itens 2.4 e 3).

## 7. Plano de implementação (somente após a revisão do Astra)
1. Preenchimento de `providers`/`contributions` nos itens `weekly_training_load` (puro + teste unitário).
2. Estender `redactEvidenceForProvider` / `redactAgentInputForProvider` com a lista de variáveis a invalidar por origem (hoje: `activity_objective`).
3. Testes de integração da seção 4.
4. Atualizar `REVISAO_ASTRA_ETAPA_1_2A.md` e o rascunho legal.
Lote pequeno, um commit, sem migration, sem alteração de prompts/modelos.
