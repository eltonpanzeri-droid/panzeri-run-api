import { ZeppFitActivity, ZeppFitPoint } from './zepp-fit';

// Filtro por CAMPO conforme o que o aluno autorizou (Lote 3): roda DEPOIS de ler o FIT e ANTES de qualquer gravacao — o que nao esta autorizado nunca chega ao
// banco (nem a IA). A Zepp nao tem escopos por categoria, entao a restricao e' do Panzeri Run (consentimento 1.2):
//   'activity'         : data/hora, distancia, duracao, calorias, modalidade e a serie de distancia/velocidade (necessarias ao ritmo e as parciais);
//   'activity_sensors' : frequencia cardiaca, cadencia, potencia, altitude e ganho de elevacao;
//   'activity_route'   : latitude/longitude (e a marca de que ha percurso).
// Sem 'activity' nada e' guardado (o chamador descarta o evento).
export interface ConsentFilterResult {
  activity: ZeppFitActivity;
  // Nomes dos grupos de campos removidos (auditoria; nunca valores).
  removed: Array<'sensors' | 'route'>;
}

const hasData = (point: ZeppFitPoint) =>
  point.distanceMeters !== null || point.speedKmh !== null || point.heartRateBpm !== null || point.cadenceSpm !== null || point.powerWatts !== null
  || point.elevationMeters !== null || point.latitude !== null || point.longitude !== null;

export function applyZeppConsent(activity: ZeppFitActivity, categories: readonly string[]): ConsentFilterResult {
  const sensors = categories.includes('activity_sensors');
  const route = categories.includes('activity_route');
  const removed: ConsentFilterResult['removed'] = [];
  if (!sensors) removed.push('sensors');
  if (!route) removed.push('route');

  const points = activity.points
    .map((point): ZeppFitPoint => ({
      offsetSec: point.offsetSec,
      distanceMeters: point.distanceMeters,
      speedKmh: point.speedKmh,
      heartRateBpm: sensors ? point.heartRateBpm : null,
      cadenceSpm: sensors ? point.cadenceSpm : null,
      powerWatts: sensors ? point.powerWatts : null,
      elevationMeters: sensors ? point.elevationMeters : null,
      latitude: route ? point.latitude : null,
      longitude: route ? point.longitude : null,
    }))
    .filter(hasData);

  return {
    activity: {
      ...activity,
      avgHeartRateBpm: sensors ? activity.avgHeartRateBpm : null,
      maxHeartRateBpm: sensors ? activity.maxHeartRateBpm : null,
      cadenceAvg: sensors ? activity.cadenceAvg : null,
      powerAvgWatts: sensors ? activity.powerAvgWatts : null,
      elevationGainMeters: sensors ? activity.elevationGainMeters : null,
      hasRoute: route && points.some((point) => point.latitude !== null),
      points,
    },
    removed,
  };
}
