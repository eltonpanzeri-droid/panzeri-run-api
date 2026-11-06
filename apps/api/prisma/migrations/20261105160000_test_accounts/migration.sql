-- Cadastros de teste (05/11/2026, ordem do Elton). Acrescimo simples e reversivel (DROP COLUMN "isTestAccount").
ALTER TABLE "User" ADD COLUMN "isTestAccount" BOOLEAN NOT NULL DEFAULT false;

-- Marca os cadastros de teste informados pelo Elton (codigos 45, 61, 72 e 74) e TODAS as contas de revisao das lojas (e-mails revisao-apple-* e revisao-google-*).
-- Dados de producao alterados por este UPDATE: so' a nova coluna, so' nessas contas. Para desmarcar alguma: painel > Cadastros de teste.
UPDATE "User" SET "isTestAccount" = true
WHERE "studentCode" IN (45, 61, 72, 74)
   OR "email" LIKE 'revisao-apple-%'
   OR "email" LIKE 'revisao-google-%';
