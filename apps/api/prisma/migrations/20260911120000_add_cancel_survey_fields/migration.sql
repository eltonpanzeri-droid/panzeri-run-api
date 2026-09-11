-- 11/09: campos para pesquisa de saída (exit survey) quando o aluno cancela a assinatura.
-- Todos nullable — não afeta alunos existentes nem fluxo de signup.
-- cancelReason: motivo principal (sem_tempo, sem_resultado, preco, pausa, objetivo, tecnico, outro)
-- cancelFeedbackText: texto livre opcional ("O que poderia ter sido diferente?")
-- cancelWouldReturn: 'sim' | 'talvez' | 'nao'
ALTER TABLE "User" ADD COLUMN "cancelReason" TEXT;
ALTER TABLE "User" ADD COLUMN "cancelFeedbackText" TEXT;
ALTER TABLE "User" ADD COLUMN "cancelWouldReturn" TEXT;
