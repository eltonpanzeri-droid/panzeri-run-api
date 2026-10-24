-- 24/10/2026 — Sexo apagado do cadastro das alunas (esconde "Registrar ciclo menstrual"). Rodar no banco de producao (console do EasyPanel) SOMENTE com autorizacao do Elton.
-- PASSO 0 e PASSO 1 so LEEM. O PASSO 2 grava. Rode na ordem e mande o resultado dos passos 0 e 1 antes do passo 2.

-- PASSO 0 (somente leitura) — como esta o campo hoje, e QUANDO ele mudou (mostra se foi algo de hoje ou antigo):
SELECT COALESCE(sex, '(vazio)') AS sexo, COUNT(*) AS alunos FROM "User" WHERE role = 'student' AND "accountStatus" <> 'deleted' GROUP BY 1 ORDER BY 2 DESC;
SELECT date_trunc('day', "updatedAt")::date AS dia, COUNT(*) AS alunos_com_placeholder
FROM "User" WHERE role = 'student' AND sex = 'prefiro_nao_informar' GROUP BY 1 ORDER BY 1 DESC LIMIT 14;

-- PASSO 1 (somente leitura) — quem tem o sexo vazio/placeholder mas respondeu "Feminino" ou "Masculino" na entrevista:
SELECT u."studentCode", u.sex AS sexo_atual, oi.answers->>'personal_sex' AS sexo_na_entrevista, u."updatedAt"::date AS atualizado_em
FROM "User" u
JOIN "OnboardingInterview" oi ON oi."userId" = u.id
WHERE u.role = 'student' AND (u.sex IS NULL OR u.sex = 'prefiro_nao_informar')
  AND oi.answers->>'personal_sex' IN ('Feminino', 'Masculino')
ORDER BY u."updatedAt" DESC;

-- PASSO 2 (escrita) — restaura o sexo informado na entrevista. So toca quem esta vazio ou com o placeholder; nunca sobrescreve outro valor.
UPDATE "User" u
SET sex = oi.answers->>'personal_sex'
FROM "OnboardingInterview" oi
WHERE oi."userId" = u.id
  AND u.role = 'student'
  AND (u.sex IS NULL OR u.sex = 'prefiro_nao_informar')
  AND oi.answers->>'personal_sex' IN ('Feminino', 'Masculino');
