-- Fase 1: infraestrutura de notificações de billing e comunicação de estado de assinatura
-- Todas as colunas são nullable — migração aditiva, zero downtime, rollback seguro por DROP COLUMN.
--
-- BillingSubscription.overdueInvoiceUrl: URL da fatura pendente atual no Asaas. Populado quando
-- o status muda para overdue (via webhook ou refreshFromAsaas), limpo ao retornar para active.
-- Nunca é o checkoutUrl antigo — aponta especificamente para a cobrança que precisa de ação agora.
ALTER TABLE "BillingSubscription" ADD COLUMN "overdueInvoiceUrl" TEXT;

-- UserNotification.action: ação semântica interna (ex: 'billing_regularize', 'training_view').
-- Nunca uma URL externa — a URL real é resolvida autenticada via API no momento do clique.
ALTER TABLE "UserNotification" ADD COLUMN "action" TEXT;

-- UserNotification.externalRef: ID do evento externo que originou a notificação (ex: payment.id
-- do Asaas). Chave primária de deduplicação: o mesmo evento nunca gera duas notificações,
-- independente de quantas vezes webhook ou cron reprocessar.
ALTER TABLE "UserNotification" ADD COLUMN "externalRef" TEXT;
