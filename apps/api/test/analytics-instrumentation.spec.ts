import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { RecordEventDto } from '../src/funnel/funnel.controller';
import { BillingService, isFirstPaidAcquisition } from '../src/billing/billing.service';
import { script as landingScript } from '../src/landing/script';
import { buildCohortSteps } from '../src/funnel/funnel.service';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const mobileSource = readFileSync(resolve(__dirname, '../../mobile/App.tsx'), 'utf8');

describe('instrumentacao definitiva do funil', () => {
  it('aceita journeyId e chave de idempotencia sem PII', async () => {
    const dto = plainToInstance(RecordEventDto, {
      sessionId: 'session-1', journeyId: 'journey-1', event: 'quick_intake_completed',
      userId: 'user-1', dedupeKey: 'journey-1:quick_intake_completed',
    });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('landing cria, persiste e propaga journey_id sem bloquear o CTA', () => {
    expect(landingScript).toContain("localStorage.getItem('panzeri_journey_id')");
    expect(landingScript).toContain("checkout.searchParams.set('journey_id',journeyId)");
    expect(landingScript).toContain("fetch('/analytics/event'");
    expect(landingScript).toContain("window.gtag('event',event");
    expect(landingScript).toContain('.catch(()=>{})');
  });

  it('só conclui quick intake após o backend devolver o marco persistido', () => {
    expect(mobileSource).toContain("quickIntakeWasCompleted = Boolean(data?.quickIntakeCompletedAt)");
    expect(mobileSource).toContain("mode === 'quickIntake' && quickIntakeWasCompleted");
  });

  it('só registra checkout criado quando a URL retornada é válida e classifica a falha', () => {
    expect(mobileSource).toContain('const hasValidCheckoutUrl');
    expect(mobileSource).toContain("reason: 'invalid_checkout_url'");
    expect(mobileSource.indexOf("trackFunnel('checkout_created'")).toBeGreaterThan(mobileSource.indexOf('const hasValidCheckoutUrl'));
  });

  it.each([
    ['active', 'active', 'pay-renewal', false],
    ['overdue', 'active', 'pay-recovery', false],
    ['pending', 'active', null, false],
    ['pending', 'active', 'pay-first', true],
  ])('classifica primeira aquisicao sem contar renovacao ou recuperacao', (before, after, paymentId, expected) => {
    expect(isFirstPaidAcquisition(before, after, paymentId)).toBe(expected);
  });

  it('registra a conversao paga uma unica vez mesmo com webhook repetido', async () => {
    const create = jest.fn().mockResolvedValue({});
    const updateMany = jest.fn().mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    const prisma = {
      funnelEvent: { findFirst: jest.fn().mockResolvedValue({ journeyId: 'journey-1', sessionId: 'session-1' }) },
      $transaction: jest.fn(async (callback: (tx: unknown) => unknown) => callback({
        billingSubscription: { updateMany }, funnelEvent: { create },
      })),
    };
    const target = { prisma, logger: { warn: jest.fn() } };
    const record = (BillingService.prototype as unknown as { recordFirstPaidConversion: (...args: string[]) => Promise<void> }).recordFirstPaidConversion;
    await record.call(target, 'billing-1', 'user-1', 'payment-1', 'subscription-1');
    await record.call(target, 'billing-1', 'user-1', 'payment-1', 'subscription-1');
    expect(create).toHaveBeenCalledTimes(1);
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({
      event: 'subscription_payment_confirmed', journeyId: 'journey-1', userId: 'user-1',
      dedupeKey: 'subscription_payment_confirmed:subscription-1',
    }) }));
  });

  it('deduplica jornadas e mantem a mesma coorte entre etapas', () => {
    const event = (name: string, journeyId: string) => ({ event: name, questionId: null, journeyId, userId: null, sessionId: `s-${journeyId}` });
    const result = buildCohortSteps([
      event('app_opened', 'a'), event('app_opened', 'a'), event('app_opened', 'b'),
      event('signup_completed', 'a'), event('signup_completed', 'c'),
    ], [
      { event: 'app_opened', label: 'PWA' }, { event: 'signup_completed', label: 'Conta' },
    ]);
    expect(result[0]).toMatchObject({ journeys: 2, conversionFromPrevious: 100 });
    expect(result[1]).toMatchObject({ journeys: 1, conversionFromPrevious: 50 });
  });
});
