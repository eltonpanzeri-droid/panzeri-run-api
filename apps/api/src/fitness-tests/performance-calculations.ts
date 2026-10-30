import { danielsFromPerformance } from '../physiology/physiology-models';

export interface ThreeKmMetrics {
  vo2maxEstimated: number;
  vvo2Kmh: number;
  paceSecondsPerKm: number;
}

// 30/10/2026: modelo de Daniels e Gilbert (1979) no lugar de 483/t + 3,5, que era a equacao do teste de 1,5 milha sem validacao para 3 km.
// vvo2Kmh e a velocidade no VO2max do modelo (nao mais a velocidade media dos 3 km). Detalhes e limitacoes: TESTES_FISICOS_LOTE1_MODELOS.md.
export function calculateThreeKmMetrics(totalSeconds: number): ThreeKmMetrics {
  const { vdot, vvo2Kmh } = danielsFromPerformance(3000, totalSeconds);
  return {
    vo2maxEstimated: round(vdot, 1),
    vvo2Kmh: round(vvo2Kmh, 2),
    paceSecondsPerKm: Math.round(totalSeconds / 3),
  };
}

export function formatPace(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}/km`;
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}
