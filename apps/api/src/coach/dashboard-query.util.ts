// 28/08: extraido de coach.controller.ts pra CoachController e CoachToolingController usarem a
// mesma logica de parsing/clamping dos parametros de paginacao — sem isso, cada controller tinha
// sua propria copia, e um ajuste futuro no clamp/trim so' seria aplicado num dos dois sem ninguem
// perceber a divergencia.
export function parseDashboardQuery(query: { search?: string; page?: string; pageSize?: string; includeArchived?: string }) {
  return {
    search: query.search?.trim() ?? '',
    page: Math.max(Number(query.page) || 1, 1),
    pageSize: Math.min(Math.max(Number(query.pageSize) || 25, 5), 100),
    includeArchived: query.includeArchived === '1' || query.includeArchived === 'true',
  };
}
