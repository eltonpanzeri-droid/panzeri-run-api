// Adaptador NATIVO do Health Connect (somente Android). A biblioteca e' carregada sob demanda, so' no Android: no PWA/iOS nada disso e' executado.
// Todo o resto do fluxo (sync.ts) depende apenas da interface HealthConnectGateway.
import { Platform } from 'react-native';
import { HC_PERMISSIONS, HcRawDistance, HcRawHeartRate, HcRawSession, SdkStatus } from './contract';
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
    async requestPermissions() {
      const granted = await lib().requestPermission(HC_PERMISSIONS.map((item) => ({ ...item })));
      return granted.filter((item) => item.accessType === 'read').map((item) => item.recordType as string);
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
  };
}
