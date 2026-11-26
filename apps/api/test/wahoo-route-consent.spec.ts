import { LegacyConsentService } from '../src/legacy-consent/legacy-consent.service';
import { LEGACY_CONSENT_DOCUMENTS, WAHOO_ROUTE_PURPOSE_ID } from '../src/legacy-consent/legacy-consent';
import { isWahooRouteConsentCurrent, wahooRoutePurpose } from '../src/wahoo/wahoo-route-consent';
import { purposeTextHash } from '../src/provider-hub/provider-consent.service';
import { seriesRows } from '../src/wahoo/wahoo-fit';

// 26/11/2026 — ordem de Elton: sem travas de dado exceto o Health Connect. Percurso GPS da Wahoo com autorizacao PROPRIA da aluna (LGPD): so' guarda depois de autorizar, sobre o texto vigente;
// retirar apaga o percurso ja guardado. Decidir sobre o percurso nunca mexe no Atlas.
const purpose = () => wahooRoutePurpose();
const hash = () => purposeTextHash(purpose());

describe('documento: o percurso so existe para a Wahoo', () => {
  it('a Wahoo traz a finalidade opcional "route_gps" com tela propria; a Polar nao (tem o grupo dela)', () => {
    expect(LEGACY_CONSENT_DOCUMENTS.wahoo.optionalPurposes.map((p) => p.id)).toEqual(['ai_external', WAHOO_ROUTE_PURPOSE_ID]);
    expect(LEGACY_CONSENT_DOCUMENTS.polar.optionalPurposes.map((p) => p.id)).toEqual(['ai_external']);
    expect(purpose().screen!.paragraphs.join(' ')).toContain('apagado');
    expect(purpose().external).toBe(false);
  });
  it('o texto do Atlas da Wahoo nao mudou (a decisao ja registrada pelas alunas continua valendo)', () => {
    const atlas = LEGACY_CONSENT_DOCUMENTS.wahoo.optionalPurposes.find((p) => p.id === 'ai_external')!;
    expect(atlas.screen!.version).toBe('1.0');
    expect(atlas.screen!.dateLabel).toBe('22/10/2026');
  });
});

describe('isWahooRouteConsentCurrent: fail-closed', () => {
  const ok = () => ({ disconnectedAt: null, routeConsentedAt: new Date(), routeConsentVersion: purpose().screen!.version, routeConsentTextHash: hash() });
  it('autorizada sobre o texto vigente: vale', () => expect(isWahooRouteConsentCurrent(ok())).toBe(true));
  it('sem registro, desconectada, texto/versao diferente ou sem data: nao vale', () => {
    expect(isWahooRouteConsentCurrent(null)).toBe(false);
    expect(isWahooRouteConsentCurrent({ ...ok(), disconnectedAt: new Date() })).toBe(false);
    expect(isWahooRouteConsentCurrent({ ...ok(), routeConsentVersion: '0.9' })).toBe(false);
    expect(isWahooRouteConsentCurrent({ ...ok(), routeConsentTextHash: 'outro' })).toBe(false);
    expect(isWahooRouteConsentCurrent({ ...ok(), routeConsentedAt: null })).toBe(false);
  });
});

describe('seriesRows: coordenadas so entram com keepRoute', () => {
  const activity = { points: [{ offsetSec: 5, distanceMeters: 20.5, speedKmh: 10.2, heartRateBpm: 150, cadenceSpm: null, powerWatts: null, elevationMeters: 12, latitude: -19.9, longitude: -43.9 }] } as never;
  it('padrao (sem autorizacao): sem latitude/longitude', () => expect(Object.keys(seriesRows(activity, 'log1')[0])).not.toContain('latitude'));
  it('com autorizacao: latitude e longitude gravadas', () => expect(seriesRows(activity, 'log1', true)[0]).toMatchObject({ latitude: -19.9, longitude: -43.9 }));
});

describe('LegacyConsentService.setWahooRoute', () => {
  const build = (connection: unknown) => {
    const calls: string[] = [];
    const prisma = {
      wahooConnection: {
        findUnique: jest.fn(async () => connection),
        update: jest.fn(async (args: unknown) => { calls.push(`wahoo.update ${JSON.stringify((args as { data: unknown }).data)}`); return {}; }),
      },
      activityTimeSeriesPoint: { updateMany: jest.fn(async () => { calls.push('serie.apagaCoordenadas'); return { count: 3 }; }) },
      activityLog: { updateMany: jest.fn(async () => { calls.push('log.hasRoute=false'); return { count: 1 }; }) },
      providerConnection: { findUnique: jest.fn(async () => null) },
      providerConnectionEvent: { create: jest.fn(async (args: { data: { type: string } }) => { calls.push(`evento ${args.data.type}`); return {}; }), findFirst: jest.fn(async () => null) },
      polarConnection: { findUnique: jest.fn(async () => null) },
      $transaction: jest.fn(async (ops: Array<Promise<unknown>>) => Promise.all(ops)),
    };
    return { service: new LegacyConsentService(prisma as never), prisma, calls };
  };
  const active = { disconnectedAt: null, routeConsentVersion: null, routeConsentTextHash: null, routeConsentedAt: null };

  it('autorizar com aceite e texto vigente grava versao/hash e registra evento', async () => {
    const { service, prisma, calls } = build(active);
    await service.setWahooRoute('wahoo', 'u1', { grant: true, acknowledged: true, version: purpose().screen!.version, textHash: hash() });
    expect(prisma.wahooConnection.update).toHaveBeenCalledTimes(1);
    expect(calls.join('|')).toContain('routeConsentVersion');
    expect(calls).toContain('evento route_granted');
  });
  it('sem aceite expresso ou com texto antigo: recusa e nada e gravado', async () => {
    const a = build(active);
    await expect(a.service.setWahooRoute('wahoo', 'u1', { grant: true, acknowledged: false, version: purpose().screen!.version, textHash: hash() })).rejects.toThrow();
    const b = build(active);
    await expect(b.service.setWahooRoute('wahoo', 'u1', { grant: true, acknowledged: true, version: '0.1', textHash: 'x' })).rejects.toThrow();
    expect(a.prisma.wahooConnection.update).not.toHaveBeenCalled();
    expect(b.prisma.wahooConnection.update).not.toHaveBeenCalled();
  });
  it('retirar APAGA as coordenadas ja guardadas e a marca de percurso, e limpa o registro', async () => {
    const { service, calls } = build({ ...active, routeConsentedAt: new Date() });
    await service.setWahooRoute('wahoo', 'u1', { grant: false });
    expect(calls).toEqual(expect.arrayContaining(['serie.apagaCoordenadas', 'log.hasRoute=false', 'evento route_revoked']));
  });
  it('sem conexao Wahoo ativa: recusa; outro provedor: nao existe', async () => {
    await expect(build(null).service.setWahooRoute('wahoo', 'u1', { grant: true, acknowledged: true })).rejects.toThrow();
    await expect(build(active).service.setWahooRoute('polar', 'u1', { grant: true })).rejects.toThrow();
  });
});
