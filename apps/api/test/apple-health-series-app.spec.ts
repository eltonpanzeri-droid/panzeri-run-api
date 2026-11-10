import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { emptyCounters, messageFor, pendingNotes, summarize } from '../../mobile/src/appleHealthSync/appleHealthSyncLogic';

// 10/11/2026: o app le as series do treino no iPhone e envia ao servidor (so' com o grupo de medidas). Nao ha como compilar o Swift aqui: conferimos o contrato entre as camadas.
const read = (...parts: string[]) => readFileSync(join(__dirname, '..', '..', 'mobile', ...parts), 'utf8');

describe('series do treino no app (contrato entre camadas)', () => {
  const swift = read('modules', 'panzeri-apple-health', 'ios', 'PanzeriAppleHealthModule.swift');
  const bridge = read('modules', 'panzeri-apple-health', 'src', 'index.ts');
  const card = read('src', 'appleHealthSync', 'AppleHealthSyncCard.tsx');

  it('o modulo nativo expoe readWorkoutSeries, so le (nunca escreve) e a ponte JS tem o mesmo nome e a mesma forma', () => {
    expect(swift).toContain('AsyncFunction("readWorkoutSeries")');
    expect(swift).toContain('case "W": return HKUnit.watt()');
    expect(swift).not.toMatch(/healthStore\.save|HKQuantitySample\(type/);
    expect(bridge).toContain('readWorkoutSeries(uuid: string, specsJson: string, maxSamples: number)');
    expect(bridge).toContain('export const readWorkoutSeries');
  });

  it('tipos lidos casam com os que o app ja pede ao iOS e com as metricas que o servidor aceita', () => {
    for (const identifier of ['HeartRate', 'RunningSpeed', 'RunningPower', 'StepCount', 'DistanceWalkingRunning']) expect(card).toContain(`HKQuantityTypeIdentifier${identifier}`);
    for (const requested of ['heartRate', 'runningSpeed', 'runningPower', 'stepCount', 'distanceWalkingRunning']) expect(swift).toContain(`HKQuantityType(.${requested})`);
    for (const metric of ['heartRate', 'runningSpeed', 'runningPower', 'stepCount', 'distance']) expect(card).toContain(`metric: '${metric}'`);
  });

  it('so envia series com o grupo de medidas autorizado; 403 do servidor nao derruba a sincronizacao; cada treino e lido uma vez', () => {
    expect(card).toContain("granted.has('sensors')");
    expect(card).toMatch(/error\.status === 401 \|\| error\.status === 403\) \? null/);
    expect(card).toContain("pr:appleSeriesChecked");
    expect(card).toContain("'/apple-health/series/pending'");
    expect(card).toContain("'/apple-health/series'");
  });

  it('mensagens: conta e avisa as series', () => {
    const counters = { ...emptyCounters(), seriesStored: 2, seriesFailed: 1 };
    expect(summarize(counters)).toContain('2 treinos com gráficos');
    expect(pendingNotes(counters).join(' ')).toContain('1 treino não teve os gráficos');
    expect(messageFor('completed', { ...emptyCounters(), seriesStored: 1 }).text).toContain('1 treino com gráficos');
  });
});
