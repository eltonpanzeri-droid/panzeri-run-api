// 28/08: extraido de coach.controller.ts pra CoachController e CoachToolingController usarem a
// mesma logica de parsing/clamping dos parametros de paginacao — sem isso, cada controller tinha
// sua propria copia, e um ajuste futuro no clamp/trim so' seria aplicado num dos dois sem ninguem
// perceber a divergencia.
export function parseDashboardQuery(query: {
  search?: string; page?: string; pageSize?: string; includeArchived?: string;
  // 23/09: paymentGroup/trainingStatus — antes os dois filtros da Lista operacional eram so'
  // client-side, aplicados em cima da PAGINA ja carregada (25 por vez). Isso fazia a contagem
  // exibida (e ate' a lista de resultados) ficar restrita ao que coube naquela pagina, em vez do
  // total real da divisao inteira. Agora sao filtros de verdade no backend.
  paymentGroup?: string; trainingStatus?: string;
}) {
  return {
    search: query.search?.trim() ?? '',
    page: Math.max(Number(query.page) || 1, 1),
    pageSize: Math.min(Math.max(Number(query.pageSize) || 25, 5), 100),
    includeArchived: query.includeArchived === '1' || query.includeArchived === 'true',
    paymentGroup: query.paymentGroup?.trim() || undefined,
    trainingStatus: query.trainingStatus?.trim() || undefined,
  };
}
