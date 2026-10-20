-- 19/10/2026 — Governanca de dados para IA (Central Universal, Lote 1). Migration ADITIVA: 1 coluna NULAVEL (StudentProfileEvent.sourceProviders = provedores de dispositivo de que o texto
-- do evento deriva). Nenhuma linha existente e' alterada (nulo = nao derivado de dispositivo / anterior ao campo). Reversao: ALTER TABLE "StudentProfileEvent" DROP COLUMN "sourceProviders".

-- AlterTable
ALTER TABLE "StudentProfileEvent" ADD COLUMN     "sourceProviders" JSONB;

