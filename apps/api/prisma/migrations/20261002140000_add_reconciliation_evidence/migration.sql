-- Motor de Reconciliacao V1: colunas aditivas e nullable em SessionExecutionLink. Nao reescreve
-- nenhuma linha existente (matchMethod/evidence ficam NULL para vinculos criados antes desta
-- migration, o que e' o estado correto: eles nunca tiveram essa explicabilidade calculada). O valor
-- 'candidate' de status e' um valor de aplicacao, nao uma constraint de banco — nenhuma mudanca de
-- schema necessaria alem das colunas novas.
ALTER TABLE "SessionExecutionLink" ADD COLUMN     "matchMethod" TEXT;
ALTER TABLE "SessionExecutionLink" ADD COLUMN     "evidence" JSONB;
