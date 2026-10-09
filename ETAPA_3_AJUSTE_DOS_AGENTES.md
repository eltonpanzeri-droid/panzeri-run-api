# Etapa 3 — Aperfeiçoamento dos prompts e da inteligência dos agentes

Sem novos agentes, sem novas chamadas de IA, sem alterar cálculos ou limiares da 2.2.

1. **Regeneração individual (ajuste 1):** `TrainingAnalystService.forDayRegeneration` lê o retrato (semana + evolução) entregue com o programa do dia — somente leitura, respeita a data de referência da geração. Entra no prompt do dia de corrida (`analiseTecnicaDoAnalistaDeTreinos`) e na rastreabilidade/exclusão de provedor. Dia de força não recebe (sem série de corrida).
2. **Seleção de evidências (ajuste 2):** `toPrescriberEvidence(parts, focus)` ordena por sustentação/horizonte + tipo (dificuldade/divergência/padrão) + recorrência + aderência ao objetivo e às diretrizes + tipo da sessão. Mesmas quantidades (controle de tokens); só ordena o que já foi calculado.
3. **Fundamentação (ajuste 3):** o Prescritor pode citar `analiseTecnicaDoAnalistaDeTreinos` e `relatorioDeExecucaoDaSemanaAnterior` em `reasoning.basis` (antes impossível) e declarar `decides` (intensidade/volume/recuperação/progressão/estrutura/manutenção/outra). Ligado ao item `training_analysis`/`weekly_execution_report` do índice por código; continua sendo declaração, não prova.
4. **Prompts:** `ANALYST_EVIDENCE_INSTRUCTION` ampliada (raciocínio técnico, variáveis não intercambiáveis, capacidade ≠ obrigação, semana ruim não apaga capacidade, evolução ≠ pace, tom do texto ao aluno); `ANALYST_DAY_INSTRUCTION` (dia); `REASONING_INSTRUCTION` (campo `decides`); condensação do Prontuário (capacidade atual × histórica, hipóteses, nada de VO₂ não medido).
5. **Prontuário:** evento `TRAINING_ANALYSIS_FINDINGS` (≤900 caracteres, sem IA para gravar, sem duplicar o anterior) gravado após a geração semanal e condensado pelo fluxo existente. Tratado como narrativa derivada de dispositivo para a exclusão de provedor.
6. **Texto ao aluno:** único campo é `recommendation`; orientado a "o que foi feito / o que representa / o que mudou / o que não sabemos", sem elogio genérico.
7. **Não alterados:** Evolução, Relator, Gerente Técnico (sem inconsistência concreta encontrada).

Custo: 0 chamadas novas. Estimativa: semana ≈ +450 tokens no prompt de sistema (cacheado) e +~250 por evento do Prontuário na condensação; dia de corrida ≈ +120 (sistema, cacheado) e ≤ ~900 de evidência.
