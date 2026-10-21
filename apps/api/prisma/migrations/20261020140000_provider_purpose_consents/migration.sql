-- Consentimento Zepp 2.0 (20/10/2026): registro, POR FINALIDADE opcional, da versao e do hash do texto sobre o qual o aluno autorizou. Somente uma coluna NOVA, NULAVEL,
-- sem valor padrao (nenhuma linha existente muda). Finalidade com tela propria (envio de treinos ao relogio, analise por IA) so' vale se o registro bate com o texto vigente.
-- Reversivel: ALTER TABLE "ProviderConnection" DROP COLUMN "purposeConsents".
ALTER TABLE "ProviderConnection" ADD COLUMN "purposeConsents" JSONB;
