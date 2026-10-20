-- Lote 3 Zepp (20/10/2026): a serie temporal canonica passa a poder guardar localizacao, altitude e potencia (vindas do FIT autorizado pelo aluno).
-- Somente colunas NOVAS, NULAVEIS, sem valor padrao: nenhuma linha existente muda. Latitude/longitude so' sao gravadas quando o aluno autorizou "Percursos e GPS";
-- altitude e potencia, quando autorizou "Sensores das atividades". Reversivel: DROP COLUMN das quatro colunas (as linhas antigas nao as usam).
ALTER TABLE "ActivityTimeSeriesPoint" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "ActivityTimeSeriesPoint" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "ActivityTimeSeriesPoint" ADD COLUMN "elevationMeters" DOUBLE PRECISION;
ALTER TABLE "ActivityTimeSeriesPoint" ADD COLUMN "powerWatts" INTEGER;
