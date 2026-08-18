-- 18/08: studentCode deixa de ser atribuido automaticamente no cadastro. A sequence continua
-- existindo (User_studentCode_seq) pra ser consultada manualmente so quando o aluno realmente
-- vira pagante (ver BillingService.assignStudentCodeIfNeeded). Registros existentes mantem o
-- codigo que ja tinham (nao ha renumeracao retroativa).
ALTER TABLE "User" ALTER COLUMN "studentCode" DROP DEFAULT;
ALTER TABLE "User" ALTER COLUMN "studentCode" DROP NOT NULL;
