# ADR 0001 — Prescrição × Execução: modelo canônico de longo prazo e dívida arquitetural assumida

- **Data:** 01/10/2026
- **Status:** `active` (decisão tomada, implementação parcial deliberadamente adiada)
- **Contexto da decisão:** fundação Prescrição × Execução (`SessionExecutionLink`, commit `3d326b8`), revisão conceitual solicitada por Elton logo após a implementação.
- **Gatilho de revisão:** qualquer novo consumidor que precise ler "atividades executadas" (Evolution, Training Intelligence, medalhas, histórico, ou futuro) deve primeiro checar este ADR antes de decidir se parte de `TrainingSession` ou da leitura canônica aqui proposta. Revisar também quando um segundo provedor (Garmin/COROS/Apple) for integrado de verdade.

## Decisão

O modelo conceitual de longo prazo do Panzeri Run para esta camada é:

- **`TrainingSession`** = intenção/prescrição (o que foi planejado).
- **`ActivityLog`** = atividade objetivamente executada (o que o dispositivo observou), canônica e agnóstica de provedor.
- **`SessionExecutionLink`** = relação entre prescrição e execução, quando essa relação existir (0..N, ambígua até resolução, com proveniência e correção preservando histórico).
- **Feedback subjetivo** (hoje `WorkoutCompletion`) é informação associada à execução — **não precisa conceitualmente de uma prescrição** para existir.

Uma atividade executada que nunca foi prescrita (ex.: ciclismo extra feito no lugar da corrida prescrita) deveria, no modelo final, existir **apenas como `ActivityLog`** — sem precisar de uma `TrainingSession` sintética só para ter um lugar onde pendurar feedback.

## Por que isso não foi implementado integralmente agora

Diagnóstico confirmado em código (não suposição): praticamente todo consumidor de "execuções do aluno" hoje parte de `trainingSession.findMany/findFirst(...).include({ completion })` como raiz da query — nunca de `WorkoutCompletion` ou `ActivityLog` como entidade raiz. Confirmado em:

- `evolution/evolution-metric.service.ts` (gráficos de evolução/carga)
- `coach/business-intelligence.service.ts`
- `medals/medal-evaluation.service.ts` e `medals/medals.service.ts`
- `training-intelligence/observation-reader.service.ts` (fundação inteira da Training Intelligence)
- `training-plans/training-plans.service.ts` (histórico do aluno, `getStudentHistory`)

Ou seja: **`TrainingSession` acidentalmente virou a interface de leitura de execuções de todo o sistema**, não só o registro de prescrições. Fazer uma atividade extra existir somente como `ActivityLog` hoje a tornaria invisível para evolução, medalhas, aderência e Training Intelligence — exatamente o oposto do objetivo ("atividade extra é parte real da carga do atleta").

## Dívida arquitetural assumida (explícita, não acidental)

1. **`device_extra`** (origin de `TrainingSession` criado por `SessionExecutionLinkService.materializeExtraActivity`) é **compatibilidade transitória com a arquitetura atual**, não o modelo canônico definitivo. Existe exclusivamente para que uma atividade extra de dispositivo tenha onde aparecer nos consumidores atuais, enquanto eles não sabem ler `ActivityLog` diretamente.
2. Daqui para frente, **nenhuma nova dependência conceitual deve assumir que toda atividade executada precisa ser uma `TrainingSession`**. Código novo que precise "ver execuções" deve ser escrito pensando na leitura canônica descrita abaixo (mesmo que, por ora, essa leitura canônica ainda não exista e o código tenha que usar `TrainingSession` como ponte) — ou seja: não espalhar mais suposições do tipo "toda execução tem `sessionId`" em lugares novos.
3. **`student_extra`** (histórico de treino extra manual, anterior a esta fundação) **permanece preservado exatamente como está**. Não será reinterpretado nem migrado retroativamente — é um fato histórico com sua própria semântica, imutável.

## Direção futura (não implementada nesta etapa)

Uma migração futura deverá:

- Criar uma **leitura canônica de execuções realizadas**, independente de a execução ter se originado de prescrição (`TrainingSession` + `completion`), de dispositivo (`ActivityLog` puro, com ou sem `SessionExecutionLink`) ou de registro manual.
- Permitir que feedback subjetivo se associe **tanto a uma `TrainingSession` quanto diretamente a uma `ActivityLog`**, sem exigir a segunda como pré-requisito da primeira.
- Migrar os consumidores atuais (Evolution, medalhas, Training Intelligence, histórico, Business Intelligence) para consultar essa leitura canônica em vez de partir direto de `trainingSession.findMany`.
- Só **depois** dessa migração, `device_extra` sintético poderá deixar de ser necessário — a materialização de `TrainingSession` para atividade extra de dispositivo pode ser removida (sem apagar as linhas já criadas: elas continuam sendo histórico real do que o sistema fez naquele momento).
- Em nenhum momento dessa migração futura haverá reinterpretação retroativa de dado existente: `student_extra` e `device_extra` já materializados continuam significando exatamente o que significavam quando foram criados.

## Alternativas consideradas

- **Implementar a leitura canônica agora, junto com esta fundação.** Rejeitada por escopo: exigiria reescrever simultaneamente Evolution, Training Intelligence, medalhas e histórico — risco alto, fora do que foi pedido como "fundação", e sem heurísticas de matching ainda maduras para justificar o investimento completo agora.
- **Não materializar `TrainingSession` para extras de dispositivo, aceitando que fiquem invisíveis para Evolution/TI/medalhas por enquanto.** Rejeitada: contradiz o requisito explícito de que atividade extra é carga real do atleta e deve ser visível.
- **Manter `student_extra` e criar o modelo novo em paralelo permanentemente (duas semânticas coexistindo para sempre).** Rejeitada: cria uma bifurcação definitiva — qualquer leitura de "quanto o aluno treinou" precisaria sempre consultar duas fontes, para sempre. Ver revisão conceitual de 01/10/2026.

## Evidência

Diagnóstico de código (buscas diretas, não inferência) realizado em 01/10/2026 durante a implementação do commit `3d326b8` e a revisão conceitual imediatamente posterior, ambos nesta mesma sessão.
