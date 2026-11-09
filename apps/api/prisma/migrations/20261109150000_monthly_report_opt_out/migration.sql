-- Relatorio mensal por e-mail (09/11/2026, ordem do Elton): a aluna pode pedir para nao receber. Acrescimo simples e reversivel (DROP COLUMN "monthlyReportOptOut"); nenhuma linha existente e alterada (todas ficam false = recebem).
ALTER TABLE "User" ADD COLUMN "monthlyReportOptOut" BOOLEAN NOT NULL DEFAULT false;
