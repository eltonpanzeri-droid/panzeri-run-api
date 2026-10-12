// Primeira versao do Panzeri Run NAO armazena coordenadas nem trajetos GPS (nao ha declaracao de localizacao nas lojas). A Polar pode listar um tipo de
// amostra de localizacao (latitude/longitude por ponto); a ingestao e' generica (guarda o que a Polar listar), entao o filtro vale por NOME do tipo e,
// por seguranca, pelo CONTEUDO (qualquer ponto com latitude e longitude). Se no futuro houver GPS (ex.: Panz Fit), este filtro e a declaracao mudam juntos.
export function isLocationSampleType(sampleType: string | null | undefined): boolean {
  return typeof sampleType === 'string' && /location|gps|route|latlng|coordinate|position/i.test(sampleType);
}

export function containsLocationPoints(value: unknown, depth = 0): boolean {
  if (value === null || typeof value !== 'object' || depth > 4) return false;
  if (Array.isArray(value)) return value.slice(0, 20).some((item) => containsLocationPoints(item, depth + 1));
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record).map((k) => k.toLowerCase());
  if ((keys.includes('latitude') && keys.includes('longitude')) || (keys.includes('lat') && (keys.includes('lng') || keys.includes('lon')))) return true;
  return Object.values(record).some((item) => containsLocationPoints(item, depth + 1));
}
