// Adaptador NATIVO do Health Connect (somente Android). A biblioteca e' carregada sob demanda, so' no Android: no PWA/iOS nada disso e' executado.
// Todo o resto do fluxo (sync.ts) depende apenas da interface HealthConnectGateway.
import { Platform } from 'react-native';
import { HC_PERMISSIONS, HcRawDistance, HcRawHeartRate, HcRawSession, SdkStatus } from './contract';
import type { DayAggregate } from './healthRecords';
import { HcLocation, routeKind } from './route';
import type { HealthConnectGateway } from './sync';

type HcLib = typeof import('react-native-health-connect');
const PAGE_SIZE = 200;
const MAX_PAGES = 25;

function lib(): HcLib {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return require('react-native-health-connect') as HcLib;
}

async function readAll<T>(read: (pageToken?: string) => Promise<{ records: T[]; pageToken?: string }>): Promise<T[]> {
  const all: T[] = [];
  let token: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await read(token);
    all.push(...result.records);
    token = result.pageToken;
    if (!token) break;
  }
  return all;
}

const filter = (range: { start: Date; end: Date }) => ({ operator: 'between' as const, startTime: range.start.toISOString(), endTime: range.end.toISOString() });

export function createNativeHealthConnectGateway(): HealthConnectGateway {
  return {
    async getSdkStatus(): Promise<SdkStatus> {
      if (Platform.OS !== 'android') return 'unavailable';
      try {
        const hc = lib();
        const status = await hc.getSdkStatus();
        if (status === hc.SdkAvailabilityStatus.SDK_AVAILABLE) return 'available';
        if (status === hc.SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) return 'update_required';
        return 'unavailable';
      } catch {
        return 'unavailable';
      }
    },
    initialize: () => lib().initialize(),
    async getGrantedRecordTypes() {
      const granted = await lib().getGrantedPermissions();
      return granted.filter((item) => item.accessType === 'read').map((item) => item.recordType as string);
    },
    // Sem argumentos: o conjunto minimo antigo (exercicio, distancia, FC). Com a lista de tipos: so' o que a aluna autorizou no consentimento do Panzeri Run.
    async requestPermissions(recordTypes?: string[], includeHistory?: boolean) {
      const request = recordTypes
        ? [...recordTypes.map((recordType) => ({ accessType: 'read' as const, recordType })), ...(includeHistory ? [{ accessType: 'read' as const, recordType: 'ReadHealthDataHistory' }] : [])]
        : HC_PERMISSIONS.map((item) => ({ ...item }));
      const granted = await lib().requestPermission(request as never);
      return (granted as Array<{ accessType: string; recordType: string }>).filter((item) => item.accessType === 'read').map((item) => item.recordType as string);
    },
    async revokeAllPermissions() {
      await lib().revokeAllPermissions();
    },
    async readSessions(range) {
      const records = await readAll((pageToken) => lib().readRecords('ExerciseSession', { timeRangeFilter: filter(range), pageSize: PAGE_SIZE, pageToken }));
      return records as unknown as HcRawSession[];
    },
    async readDistance(range, dataOrigin) {
      const records = await readAll((pageToken) => lib().readRecords('Distance', { timeRangeFilter: filter(range), dataOriginFilter: dataOrigin ? [dataOrigin] : undefined, pageSize: PAGE_SIZE, pageToken }));
      return records as unknown as HcRawDistance[];
    },
    async readHeartRate(range, dataOrigin) {
      const records = await readAll((pageToken) => lib().readRecords('HeartRate', { timeRangeFilter: filter(range), dataOriginFilter: dataOrigin ? [dataOrigin] : undefined, pageSize: PAGE_SIZE, pageToken }));
      return records as unknown as HcRawHeartRate[];
    },
    // Percurso GPS de UM exercicio. Com os pontos ja' na sessao (tipo DATA) le direto; se o Android exigir confirmacao (CONSENT_REQUIRED), so' pergunta quando a leitura e' interativa
    // (toque em "Sincronizar agora"): em segundo plano ou ao abrir o app nunca aparece janela surpresa.
    // Devolve 'denied' quando a aluna recusa (ou o Android nega) o acesso daquele exercicio: nao e' erro da sincronizacao e nao se pergunta de novo.
    async getExerciseRoute(session, interactive): Promise<HcLocation[] | 'denied'> {
      const route = session.exerciseRoute;
      const kind = routeKind(route?.type);
      if (kind === 'data' && Array.isArray(route?.route) && route!.route!.length > 0) return route!.route as HcLocation[];
      const recordId = session.metadata?.id;
      if (kind === 'consent' && interactive && recordId) {
        try {
          const granted = await lib().requestExerciseRoute(recordId);
          return (granted?.route ?? []) as unknown as HcLocation[];
        } catch {
          return 'denied';
        }
      }
      return [];
    },
    // Acesso para ler em SEGUNDO PLANO (permissao propria do Android; so' a aluna concede, em janela do sistema).
    async hasBackgroundAccess() {
      const granted = await lib().getGrantedPermissions();
      return (granted as Array<{ recordType: string }>).some((item) => item.recordType === 'BackgroundAccessPermission');
    },
    async requestBackgroundAccess() {
      const granted = await lib().requestPermission([{ accessType: 'read', recordType: 'BackgroundAccessPermission' }] as never);
      return (granted as Array<{ recordType: string }>).some((item) => item.recordType === 'BackgroundAccessPermission');
    },
    // Leitura generica de qualquer tipo de registro (so' e' chamada para tipos que a aluna autorizou e o Android liberou).
    async readAny(recordType, range, dataOrigin) {
      const records = await readAll((pageToken) => lib().readRecords(recordType as never, { timeRangeFilter: filter(range), dataOriginFilter: dataOrigin ? [dataOrigin] : undefined, pageSize: PAGE_SIZE, pageToken }) as never);
      return records as unknown[];
    },
    // Totais do DIA calculados pelo proprio Health Connect (ele ja' evita contar duas vezes o mesmo passo gravado por celular e relogio).
    async aggregateDay(range, granted): Promise<DayAggregate> {
      const hc = lib();
      const timeRangeFilter = filter(range);
      const safe = async <T,>(type: string, run: () => Promise<T>): Promise<T | null> => (granted.includes(type) ? run().catch(() => null) : null);
      const steps = await safe('Steps', () => hc.aggregateRecord({ recordType: 'Steps', timeRangeFilter }));
      const distance = await safe('Distance', () => hc.aggregateRecord({ recordType: 'Distance', timeRangeFilter }));
      const active = await safe('ActiveCaloriesBurned', () => hc.aggregateRecord({ recordType: 'ActiveCaloriesBurned', timeRangeFilter }));
      const total = await safe('TotalCaloriesBurned', () => hc.aggregateRecord({ recordType: 'TotalCaloriesBurned', timeRangeFilter }));
      const n = (value: unknown) => (typeof value === 'number' && Number.isFinite(value) ? value : null);
      return {
        steps: n((steps as { COUNT_TOTAL?: number } | null)?.COUNT_TOTAL),
        distanceMeters: n((distance as { DISTANCE?: { inMeters?: number } } | null)?.DISTANCE?.inMeters),
        activeKilocalories: n((active as { ACTIVE_CALORIES_TOTAL?: { inKilocalories?: number } } | null)?.ACTIVE_CALORIES_TOTAL?.inKilocalories),
        totalKilocalories: n((total as { BASAL_CALORIES_TOTAL?: unknown; ENERGY_TOTAL?: { inKilocalories?: number } } | null)?.ENERGY_TOTAL?.inKilocalories),
      };
    },
  };
}
