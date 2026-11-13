import 'reflect-metadata';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RecordEventDto } from '../src/funnel/funnel.controller';
import { ACQUISITION_STEPS, ACTIVATION_STEPS, buildCohortSteps } from '../src/funnel/funnel.service';
import { script as landingScript } from '../src/landing/script';

// Instrumentacao do funil e da Meta (REESCRITO em 13/11/2026). A versao de setembro testava funcoes que o incidente do commit 617788a apagou (isFirstPaidAcquisition, buildCohortSteps, quick intake
// no navegador). Aqui: o que existe HOJE — funil por coorte restaurado, aviso de compra (Purchase) so' na primeira compra e jornada da landing. Os campos enviados a Meta (e o texto da Politica que
// os descreve) ficam em legal-consent-meta.spec.ts.
const billingSource = readFileSync(resolve(__dirname, '../src/billing/billing.service.ts'), 'utf8');
const authSource = readFileSync(resolve(__dirname, '../src/auth/auth.service.ts'), 'utf8');

describe('funil: eventos e jornada', () => {
  it('aceita journeyId e chave de idempotencia sem PII', async () => {
    const dto = plainToInstance(RecordEventDto, { sessionId: 'session-1', journeyId: 'journey-1', event: 'interview_completed', userId: 'user-1', dedupeKey: 'journey-1:interview_completed' });
    expect(await validate(dto)).toHaveLength(0);
  });

  it('a landing cria, persiste e propaga a jornada sem bloquear o CTA (comportamento executado em journey-foundation.spec)', () => {
    expect(landingScript).toContain("'panzeri_journey_id'");
    expect(landingScript).toContain("searchParams.set('journey_id',journeyId)");
    expect(landingScript).toContain('/analytics/event');
  });
});

describe('funil por coorte (restaurado)', () => {
  const ev = (event: string, journeyId: string, extra: Partial<{ userId: string | null; sessionId: string; questionId: string | null }> = {}) => ({ event, questionId: null, journeyId, userId: null, sessionId: `s-${journeyId}`, ...extra });

  it('deduplica jornadas e mantem a MESMA coorte entre etapas (quem pulou uma etapa nao entra nas seguintes)', () => {
    const result = buildCohortSteps([
      ev('app_opened', 'a'), ev('app_opened', 'a'), ev('app_opened', 'b'),
      ev('signup_completed', 'a'), ev('signup_completed', 'c'),
    ], [{ event: 'app_opened', label: 'App' }, { event: 'signup_completed', label: 'Conta' }]);
    expect(result[0]).toMatchObject({ journeys: 2, conversionFromPrevious: 100 });
    expect(result[1]).toMatchObject({ journeys: 1, conversionFromPrevious: 50 }); // 'c' nunca abriu o app: fora da coorte
  });

  it('sem journeyId, a pessoa e identificada pela conta; sem conta, pela sessao; conversao nunca passa de 100%', () => {
    const events = [
      { event: 'signup_completed', questionId: null, journeyId: null, userId: 'u1', sessionId: 's1' },
      { event: 'payment_started', questionId: null, journeyId: null, userId: 'u1', sessionId: 's9' },
      { event: 'payment_started', questionId: null, journeyId: null, userId: null, sessionId: 'x' },
    ];
    const steps = buildCohortSteps(events, [{ event: 'signup_completed', label: 'a' }, { event: 'payment_started', label: 'b' }]);
    expect(steps[1].journeys).toBe(1);
    for (const step of steps) expect(step.conversionFromPrevious).toBeLessThanOrEqual(100);
    expect(buildCohortSteps([], [{ event: 'app_opened', label: 'x' }])[0]).toMatchObject({ journeys: 0, conversionFromPrevious: 0 });
  });

  it('as etapas usam so eventos que o fluxo atual emite (cadastro curto -> pagamento -> entrevista -> rotina -> 1o programa)', () => {
    expect(ACQUISITION_STEPS.map((s) => s.event)).toEqual(['landing_view', 'landing_cta_click', 'app_opened', 'signup_started', 'signup_completed', 'payment_started', 'payment_completed']);
    expect(ACTIVATION_STEPS.map((s) => s.event)).toEqual(['payment_completed', 'interview_started', 'interview_completed', 'routine_configured', 'first_plan_generated']);
    const mobile = readFileSync(resolve(__dirname, '../../mobile/App.tsx'), 'utf8');
    for (const name of ['app_opened', 'signup_started', 'signup_completed', 'payment_started', 'payment_completed', 'interview_started', 'interview_completed', 'routine_configured']) expect(mobile).toContain(`trackFunnel('${name}'`);
    expect(readFileSync(resolve(__dirname, '../src/training-plans/training-plans.service.ts'), 'utf8')).toContain("'first_plan_generated'");
  });
});

describe('Meta: quando o aviso de compra sai', () => {
  it('Purchase so na PRIMEIRA compra (nao na recuperacao de atraso nem na reativacao), com id por pagamento', () => {
    expect(billingSource).toContain('paymentId && payload.payment?.value != null && isFirstPurchaseTransition(user.subscriptionStatus, user.studentCode)');
    expect(billingSource).toContain('eventId: `purchase_${paymentId}`');
    expect(billingSource).toContain("customData: { value: payload.payment.value, currency: 'BRL' }");
  });

  it('o cadastro avisa a Meta (CompleteRegistration) e o cadastro vindo do app do iPhone nunca e enviado (App Store sem rastreamento publicitario)', () => {
    expect(authSource).toContain("eventName: 'CompleteRegistration'");
    expect(authSource).toContain('isIosAppOrigin(userAgent, clientPlatform)');
  });
});
