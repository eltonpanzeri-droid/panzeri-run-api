-- AlterTable: coluna aditiva e nullable, sem reescrever dado existente. Linhas de ActivityLog ja
-- importadas ficam com providerMetrics = NULL ate' serem resincronizadas (idempotente: o upsert do
-- adapter Polar reprocessa o mesmo externalId e preenche esta coluna na proxima sincronizacao).
ALTER TABLE "ActivityLog" ADD COLUMN     "providerMetrics" JSONB;
