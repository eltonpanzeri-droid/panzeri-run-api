-- 24/10/2026 — Reparo do sexo apagado pelo formulario "Suas informacoes" (bug que escondia "Registrar ciclo menstrual").
-- NAO roda sozinho. Rodar no banco de producao SOMENTE com autorizacao do Elton: primeiro o PASSO 1 (so le), conferir a lista, depois o PASSO 2.

-- PASSO 1 (somente leitura): quem teve o sexo trocado pelo placeholder, mas respondeu outro valor na entrevista.
SELECT u."studentCode", u.sex AS sexo_atual, oi.answers->>'personal_sex' AS sexo_na_entrevista
FROM "User" u
JOIN "OnboardingInterview" oi ON oi."userId" = u.id
WHERE u.sex = 'prefiro_nao_informar'
  AND oi.answers->>'personal_sex' IN ('Feminino', 'Masculino');

-- PASSO 2 (escrita): restaura o sexo informado na entrevista. So toca quem esta com o placeholder.
UPDATE "User" u
SET sex = oi.answers->>'personal_sex'
FROM "OnboardingInterview" oi
WHERE oi."userId" = u.id
  AND u.sex = 'prefiro_nao_informar'
  AND oi.answers->>'personal_sex' IN ('Feminino', 'Masculino');
