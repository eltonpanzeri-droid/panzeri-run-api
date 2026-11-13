-- 13/11/2026: "Relatar problema" (Frente 1 do planejamento do proximo build). Tabelas novas e vazias: nada existente muda.
-- Rollback: DROP TABLE "ProblemReportImage"; DROP TABLE "ProblemReport";
CREATE TABLE "ProblemReport" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "appVersion" TEXT,
    "platform" TEXT,
    "osVersion" TEXT,
    "deviceModel" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "coachNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "ProblemReport_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ProblemReportImage" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "mimeType" TEXT NOT NULL,
    "byteSize" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProblemReportImage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProblemReport_userId_createdAt_idx" ON "ProblemReport"("userId", "createdAt");
CREATE INDEX "ProblemReport_status_createdAt_idx" ON "ProblemReport"("status", "createdAt");
CREATE INDEX "ProblemReportImage_reportId_idx" ON "ProblemReportImage"("reportId");

ALTER TABLE "ProblemReport" ADD CONSTRAINT "ProblemReport_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProblemReportImage" ADD CONSTRAINT "ProblemReportImage_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "ProblemReport"("id") ON DELETE CASCADE ON UPDATE CASCADE;
