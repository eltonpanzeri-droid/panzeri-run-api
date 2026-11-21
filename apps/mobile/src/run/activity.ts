// Ponto de GPS gravado durante o treino do Panzeri Run (copiado do Panz Fit, so' o que o registro precisa).
export type TrackPoint = {
  latitude: number;
  longitude: number;
  altitude: number | null;
  accuracy: number | null;
  speed: number | null;
  timestamp: number;
};
