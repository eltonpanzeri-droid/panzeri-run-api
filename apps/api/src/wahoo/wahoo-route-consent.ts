import { LEGACY_CONSENT_DOCUMENTS, WAHOO_ROUTE_PURPOSE_ID } from '../legacy-consent/legacy-consent';
import { purposeTextHash } from '../provider-hub/provider-consent.service';

// Percurso GPS da Wahoo (26/11/2026): so' vale se a aluna autorizou SOBRE O TEXTO VIGENTE (mesma versao e mesmo hash). Texto alterado depois => deixa de valer ate nova autorizacao (fail-closed).
export type WahooRouteConsentRow = { disconnectedAt?: Date | null; routeConsentVersion?: string | null; routeConsentTextHash?: string | null; routeConsentedAt?: Date | null } | null | undefined;

export function wahooRoutePurpose() {
  return LEGACY_CONSENT_DOCUMENTS.wahoo.optionalPurposes.find((purpose) => purpose.id === WAHOO_ROUTE_PURPOSE_ID)!;
}

export function isWahooRouteConsentCurrent(row: WahooRouteConsentRow): boolean {
  if (!row || row.disconnectedAt || !row.routeConsentedAt) return false;
  const purpose = wahooRoutePurpose();
  return row.routeConsentVersion === purpose.screen!.version && row.routeConsentTextHash === purposeTextHash(purpose);
}
