# Classificação individual das tendências dos feedbacks (10/2026)

**Problema (confirmado no código):** a tendência era regressão linear com "estável" só abaixo de 5% da amplitude; picos isolados em escala 1–5 viravam "vem aumentando/diminuindo".

**Nova classificação** — `LongitudinalDynamicsService.changePattern` (reaproveita percentis, MAD e a janela de 200 dias já existentes), anexada a cada janela (21/60 d) pelo `TrainingIntelligenceQueryService`:
- Registros do mesmo dia = um dia (mediana do dia).
- Referência = dias anteriores à janela (até 200 d). Faixa: P10–P90 com ≥ 12 dias; todo o intervalo observado com 4–11 dias (rotulado "limitada"); sem histórico anterior, a primeira metade da própria janela (rotulada, nunca passa de "mudança recente" se faltar persistência).
- Ruído individual = MAD/IQR robustos da referência, com piso de meio degrau em escalas ordinais (aluno sempre em 2 que passa a 3 = mudança real).
- Dia "fora do padrão" = ultrapassa a faixa por ≥ ruído. A sequência final de dias fora, do mesmo lado, decide: nenhuma → estável/oscilação (saiu e voltou); ≥ 2 → mudança recente; ≥ 3 dias e ≥ 7 dias de duração (≥ 4 e ≥ 10 com referência limitada) → sustentada. Um único registro fora, sem continuidade → oscilação "em curso" (já aparece no veredito da faixa).
- Saída (`pattern`): tipo, lado numérico (acima/abaixo; não é melhora/piora), base da referência, faixa, ruído, dias da janela, sequência, episódios, **dias que sustentam**, período e ressalva.

**Compatibilidade:** `trend.<janela>.direction` passa a ser a direção *sustentada* (`increasing/decreasing` só para mudança sustentada; `stable` nos demais; `insufficient_data` sem base). A regressão pura permanece em `slopePerDay`/`slopeDirection`. Prescritor e Evolução recebem a direção corrigida + `recentPattern`/`mediumTermPattern` (aditivo). Analista de Treinos continua com critérios próprios (MM21/MM60); apenas o rótulo `trendRecent` herda a direção corrigida. Médias móveis, faixa habitual, persistência e excursões não mudaram.

**Ordem temporal:** `getObservations` desempata observações do mesmo instante pelo id do registro de origem (antes dependia da ordem do banco).

**App:** `insights.ts` só lê `pattern` (sem matemática no frontend); com API antiga mantém o texto anterior. Perfil: removida a instância `PolarConnect` (Integrações e Privacidade e dados preservados).

**Limitações:** limiares de persistência (3/7 e 4/10 dias) e do piso de ruído são critérios conservadores gerais, não calibrados com dados reais; variável sem escala e sem histórico usa piso de 2% do valor mediano; `current` e as janelas continuam ancorados no último registro (não na data de hoje).
