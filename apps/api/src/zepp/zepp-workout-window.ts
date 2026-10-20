import { createHash } from 'node:crypto';
import { ZeppV2Workout } from './zepp-workout-spec';

// Janela de 7 dias da Workout API V2 (documentacao Zepp, 20/10/2026):
//  - corpo: startDate, endDate (inclusivos; endDate = startDate + 6 dias EXATOS) e workouts[]; todo treino precisa cair dentro da janela;
//  - toda atualizacao REENVIA a janela inteira, mesmo mudando um so' treino; dias sem treino sao omitidos;
//  - `workouts: []` APAGA no servidor da Zepp tudo de "agora" ate +7 dias (ignora as datas do cliente). Por isso uma lista vazia NUNCA sai por acidente:
//    so' com `allowEmpty: true`, que apenas o pedido explicito de "retirar treinos do relogio" usa.
export const ZEPP_WINDOW_DAYS = 7;

export class EmptyZeppWindowRefused extends Error {
  constructor() {
    super('Janela sem treinos: enviar lista vazia apagaria os treinos do relogio. So permitido por pedido explicito.');
    this.name = 'EmptyZeppWindowRefused';
  }
}

export function addDaysIso(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function zeppWindow(todayIso: string): { startDate: string; endDate: string } {
  return { startDate: todayIso, endDate: addDaysIso(todayIso, ZEPP_WINDOW_DAYS - 1) };
}

export interface ZeppWindowBody {
  startDate: string;
  endDate: string;
  workouts: ZeppV2Workout[];
}

export function buildZeppWindowBody(todayIso: string, workouts: ZeppV2Workout[], options: { allowEmpty?: boolean } = {}): ZeppWindowBody {
  const { startDate, endDate } = zeppWindow(todayIso);
  const inside = workouts
    .filter((workout) => workout.workoutDate >= startDate && workout.workoutDate <= endDate)
    .sort((a, b) => (a.workoutDate === b.workoutDate ? a.workoutId - b.workoutId : a.workoutDate < b.workoutDate ? -1 : 1));
  const ids = new Set<number>();
  for (const workout of inside) {
    // workoutId repetido faria a Zepp tratar dois treinos como um.
    if (ids.has(workout.workoutId)) throw new Error(`workoutId repetido na janela: ${workout.workoutId}`);
    ids.add(workout.workoutId);
  }
  if (inside.length === 0 && !options.allowEmpty) throw new EmptyZeppWindowRefused();
  return { startDate, endDate, workouts: inside };
}

// Impressao digital do que sera enviado (para comparar "o que a Zepp tem" com "o que deveria ter").
export function zeppWindowHash(body: ZeppWindowBody): string {
  return createHash('sha256').update(JSON.stringify(body)).digest('hex');
}
