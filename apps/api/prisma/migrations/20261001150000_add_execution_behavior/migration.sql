-- AlterTable: nova pergunta comportamental de execucao (categorica), aditiva e nullable.
-- executionVsPrescribed (coluna antiga, numerica/ordinal) NAO e alterada nem apagada — continua
-- intacta para leitura do historico. Linhas existentes ficam com executionBehavior = NULL, o que
-- e correto (nenhum registro anterior a esta migration respondeu essa pergunta nova).
ALTER TABLE "WorkoutCompletion" ADD COLUMN     "executionBehavior" TEXT;
