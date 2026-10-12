import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { AuthService } from '../src/auth/auth.service';
import { isIosAppOrigin } from '../src/auth/client-origin';
import { BillingService } from '../src/billing/billing.service';
import { containsLocationPoints, isLocationSampleType } from '../src/polar/polar-location-filter';

// Conformidade da primeira versao na App Store: sem rastreamento (Meta), sem localizacao (Polar), cancelamento correto da loja, iPhone-only.
const mobile = (p: string) => readFileSync(join(__dirname, '..', '..', 'mobile', p), 'utf8');
const IOS_APP_UA = 'PanzeriRun/5 CFNetwork/1494.0.7 Darwin/23.4.0';
const SAFARI_IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1';
const ANDROID_APP_UA = 'okhttp/4.12.0';
const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36';

describe('Meta: cadastros do app iPhone nunca sao enviados', () => {
  it('identifica o iOS nativo (cabecalho explicito ou cliente de rede do sistema) e NAO confunde site nem Android', () => {
    expect(isIosAppOrigin(IOS_APP_UA)).toBe(true);
    expect(isIosAppOrigin(undefined, 'ios-app')).toBe(true);
    expect(isIosAppOrigin(CHROME_UA, ['ios-app'])).toBe(true);
    expect(isIosAppOrigin(SAFARI_IPHONE_UA)).toBe(false); // PWA/Safari no iPhone: segue como site
    expect(isIosAppOrigin(ANDROID_APP_UA)).toBe(false);
    expect(isIosAppOrigin(CHROME_UA)).toBe(false);
    expect(isIosAppOrigin(undefined)).toBe(false);
    expect(isIosAppOrigin(IOS_APP_UA, 'web')).toBe(true); // a deducao pelo user agent continua valendo
  });

  async function register(userAgent?: string, platform?: string) {
    const sendEvent = jest.fn();
    const prisma = {
      user: {
        findMany: async () => [],
        create: async ({ data }: { data: { email: string } }) => ({ id: 'u1', email: data.email, name: 'N', role: 'student' }),
        update: async () => ({}),
      },
    };
    const service = new AuthService(prisma as never, { signAsync: async () => 'jwt' } as never, { get: () => undefined } as never, { sendEvent } as never);
    await service.register({ email: 'aluno@exemplo.com', password: 'senha-12345', name: 'Aluno', acceptedTerms: true, acceptedExerciseResponsibility: true } as never, '1.2.3.4', userAgent, platform);
    return sendEvent;
  }

  it('cadastro do app iPhone: NENHUM evento a Meta, e o cadastro conclui normalmente', async () => {
    expect(await register(IOS_APP_UA)).not.toHaveBeenCalled();
    expect(await register(undefined, 'ios-app')).not.toHaveBeenCalled();
  });

  it('site (PWA, inclusive Safari no iPhone) e Android continuam enviando o evento como antes', async () => {
    for (const ua of [CHROME_UA, SAFARI_IPHONE_UA, ANDROID_APP_UA, undefined]) {
      const sendEvent = await register(ua);
      expect(sendEvent).toHaveBeenCalledTimes(1);
      expect(sendEvent.mock.calls[0][0]).toMatchObject({ eventName: 'CompleteRegistration' });
    }
  });

  it('o app iPhone envia o cabecalho de plataforma ao cadastrar', () => {
    expect(mobile('App.tsx')).toContain("...(Platform.OS === 'ios' ? { 'X-Client-Platform': 'ios-app' } : {})");
  });
});

describe('Polar: sem coordenadas GPS', () => {
  it('ignora tipos de amostra de localizacao e qualquer conteudo com latitude/longitude', () => {
    for (const type of ['LOCATION', 'location', 'gps', 'route', 'latlng']) expect(isLocationSampleType(type)).toBe(true);
    for (const type of ['heart-rate', 'speed', 'cadence', 'altitude', 'power', '0', '3', 'unknown']) expect(isLocationSampleType(type)).toBe(false);
    expect(containsLocationPoints([{ latitude: 60.2, longitude: 25.1, time: 'PT1S' }])).toBe(true);
    expect(containsLocationPoints({ data: [{ lat: 1, lng: 2 }] })).toBe(true);
    expect(containsLocationPoints({ 'sample-type': 'x', data: { points: [{ latitude: 1, longitude: 2 }] } })).toBe(true);
    expect(containsLocationPoints({ 'recording-rate': 1, data: '120,121,119' })).toBe(false);
    expect(containsLocationPoints({ 'sample-type': 'heart-rate', samples: [{ time: 1, value: 120 }] })).toBe(false);
    expect(containsLocationPoints(null)).toBe(false);
  });

  it('a ingestao aplica os dois filtros ANTES de gravar', () => {
    const src = readFileSync(join(__dirname, '..', 'src', 'polar', 'polar-activity-ingestion.service.ts'), 'utf8');
    const one = src.slice(src.indexOf('private async ingestOneSample'));
    expect(one.indexOf('isLocationSampleType(entry.sampleType)')).toBeGreaterThan(-1);
    expect(one.indexOf('containsLocationPoints(payload)')).toBeLessThan(one.indexOf('rawActivitySample.upsert'));
    expect(one.indexOf('isLocationSampleType(entry.sampleType)')).toBeLessThan(one.indexOf('fetch(entry.url'));
  });
});

describe('Cancelamento: assinatura da loja nao e cancelada pelo servidor', () => {
  it('quem assina pela loja (Apple/Google) recebe orientacao e NADA e alterado; Asaas segue por outro caminho', async () => {
    const update = jest.fn();
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ subscriptionProvider: 'revenuecat' }), update }, billingSubscription: { findUnique: jest.fn(), update, create: update }, $transaction: update };
    const service = new BillingService(prisma as never, { get: () => undefined } as never, {} as never, {} as never, {} as never, {} as never, {} as never, {} as never);
    await expect(service.cancel('u1')).rejects.toMatchObject({ response: { code: 'store_subscription' } });
    await expect(service.cancel('u1')).rejects.toBeInstanceOf(BadRequestException);
    expect(update).not.toHaveBeenCalled();
    expect(prisma.billingSubscription.findUnique).not.toHaveBeenCalled();
  });

  it('o app abre a gestao da loja para assinantes da loja e mantem o fluxo antigo para os demais', () => {
    const app = mobile('App.tsx');
    expect(app).toContain("details?.storeManaged ? 'Gerenciar assinatura na loja' : 'Cancelar assinatura'");
    expect(app).toContain('if (details?.storeManaged) { void openStoreSubscriptionManagement(setMessage); } else { setCancelStep(\'reason\'); }');
    expect(app).toContain('managementURL');
    expect(app).toContain('https://apps.apple.com/account/subscriptions');
  });
});

describe('iPhone nativo: nada do Asaas e oferta acessivel para a revisao', () => {
  const app = mobile('App.tsx');
  it('rodape do Asaas e historico de faturas ocultos no iPhone; texto da loja para assinantes da loja', () => {
    expect(app).toContain('{details?.storeManaged ? (');
    expect(app).toContain(') : iosStoreBuild() ? null : (');
    expect(app).toContain('history.length > 0 && !iosStoreBuild() && !details?.storeManaged');
  });
  it('quem ja tem acesso pode VER a oferta da App Store, com aviso de segunda cobranca; so no iPhone nativo e so para nao-assinantes da loja', () => {
    expect(app).toContain('{iosStoreBuild() && active && !details?.storeManaged ? (');
    expect(app).toContain('Ver assinatura pela App Store');
    expect(app).toContain('geraria uma segunda cobranca');
    expect(app).toContain("onPress: () => { void subscribe(); }");
  });
  it('app so para iPhone (sem iPad); Bundle ID, versao e produto intactos', () => {
    const config = JSON.parse(mobile('app.json')) as { expo: { version: string; ios: { supportsTablet: boolean; bundleIdentifier: string }; android: { package: string } } };
    expect(config.expo.ios.supportsTablet).toBe(false);
    expect(config.expo.ios.bundleIdentifier).toBe('com.panzerirun.app');
    expect(config.expo.android.package).toBe('com.panzerirun.app');
    expect(config.expo.version).toBe('1.0.0');
    expect(app).toContain("IOS_STORE_PRODUCT_ID = 'panzeri_run_mensal'");
  });
});
