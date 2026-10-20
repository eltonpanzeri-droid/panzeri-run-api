import { FitBaseType, FitEncoder } from 'fit-file-parser/encoder';

// Gerador de FIT SINTETICO para testes (nenhum dado real). Escreve file_id, N registros (record), uma sessao (session) e, opcionalmente, a mensagem "activity" com
// o horario local (de onde sai o fuso). Valores de campo ja' na escala do FIT (a biblioteca converte na leitura): distancia x100, tempo x1000, altitude x5+500.
export interface SyntheticFitOptions {
  start?: Date;
  seconds?: number;
  sport?: number; // 1 = running, 2 = cycling, 11 = walking
  subSport?: number; // 0 = generic, 1 = treadmill
  withGps?: boolean;
  withSensors?: boolean;
  heartRate?: (second: number) => number;
  cadence?: number;
  power?: number;
  speedMs?: number;
  localOffsetMinutes?: number | null; // null = nao escreve a mensagem "activity"
  sessions?: number; // quantas mensagens session (multiesporte)
  totalAscent?: number;
  manufacturer?: number;
}

const semicircles = (degrees: number) => Math.round((degrees * 2 ** 31) / 180);

export function buildSyntheticFit(options: SyntheticFitOptions = {}): Buffer {
  const start = options.start ?? new Date('2026-10-18T09:00:00Z');
  const seconds = options.seconds ?? 600;
  const speed = options.speedMs ?? 3;
  const timestamp = (s: number) => FitEncoder.toFitTimestamp(new Date(start.getTime() + s * 1000));
  const encoder = new FitEncoder();
  encoder.writeMessage(0, [
    { number: 0, size: 1, baseType: FitBaseType.Enum, value: 4 },
    { number: 1, size: 2, baseType: FitBaseType.Uint16, value: options.manufacturer ?? 1 },
    { number: 4, size: 4, baseType: FitBaseType.Uint32, value: timestamp(0) },
  ]);
  for (let s = 0; s < seconds; s += 1) {
    const fields = [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: timestamp(s) },
      { number: 5, size: 4, baseType: FitBaseType.Uint32, value: Math.round(s * speed * 100) },
      { number: 73, size: 4, baseType: FitBaseType.Uint32, value: Math.round(speed * 1000) },
    ];
    if (options.withSensors !== false) {
      fields.push(
        { number: 3, size: 1, baseType: FitBaseType.Uint8, value: options.heartRate ? options.heartRate(s) : 140 + (s % 5) },
        { number: 4, size: 1, baseType: FitBaseType.Uint8, value: options.cadence ?? 85 },
        { number: 7, size: 2, baseType: FitBaseType.Uint16, value: options.power ?? 210 },
        { number: 78, size: 4, baseType: FitBaseType.Uint32, value: Math.round((760 + (s % 7)) * 5 + 2500) },
      );
    }
    if (options.withGps !== false) {
      fields.push(
        { number: 0, size: 4, baseType: FitBaseType.Sint32, value: semicircles(-23.55 + s * 0.00001) },
        { number: 1, size: 4, baseType: FitBaseType.Sint32, value: semicircles(-46.63) },
      );
    }
    encoder.writeMessage(20, fields);
  }
  const sessions = options.sessions ?? 1;
  for (let i = 0; i < sessions; i += 1) {
    encoder.writeMessage(18, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: timestamp(seconds) },
      { number: 2, size: 4, baseType: FitBaseType.Uint32, value: timestamp(0) },
      { number: 7, size: 4, baseType: FitBaseType.Uint32, value: seconds * 1000 },
      { number: 8, size: 4, baseType: FitBaseType.Uint32, value: seconds * 1000 },
      { number: 9, size: 4, baseType: FitBaseType.Uint32, value: Math.round(seconds * speed * 100) },
      { number: 5, size: 1, baseType: FitBaseType.Enum, value: options.sport ?? 1 },
      { number: 6, size: 1, baseType: FitBaseType.Enum, value: options.subSport ?? 0 },
      { number: 16, size: 1, baseType: FitBaseType.Uint8, value: 142 },
      { number: 17, size: 1, baseType: FitBaseType.Uint8, value: 168 },
      { number: 18, size: 1, baseType: FitBaseType.Uint8, value: options.cadence ?? 85 },
      { number: 20, size: 2, baseType: FitBaseType.Uint16, value: options.power ?? 210 },
      { number: 22, size: 2, baseType: FitBaseType.Uint16, value: options.totalAscent ?? 25 },
      { number: 11, size: 2, baseType: FitBaseType.Uint16, value: 520 },
    ]);
  }
  if (options.localOffsetMinutes !== null) {
    const offset = options.localOffsetMinutes ?? -180;
    encoder.writeMessage(34, [
      { number: 253, size: 4, baseType: FitBaseType.Uint32, value: timestamp(seconds) },
      { number: 1, size: 2, baseType: FitBaseType.Uint16, value: 1 },
      { number: 2, size: 1, baseType: FitBaseType.Enum, value: 0 },
      { number: 5, size: 4, baseType: FitBaseType.Uint32, value: timestamp(seconds) + offset * 60 },
    ]);
  }
  return Buffer.from(encoder.close());
}
