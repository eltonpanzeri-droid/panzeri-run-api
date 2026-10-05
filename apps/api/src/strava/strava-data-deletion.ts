// Exclusao dos dados de proveniencia Strava de UM usuario (05/10/2026). Funcao pura sobre o cliente Prisma (ou
// transacao), sem dependencia do Nest, para ser usada pelo app (desconexao, evento de desautorizacao) e pela CLI
// de restauracao. Idempotente. Nao toca em Polar, ActivityLog nem em nenhum dado independente do Panzeri Run.
//
// Cadeia de proveniencia Strava: StravaActivity (atividades + raw), StravaAnalysisCache e TrainingExecutionInsight
// (derivados criados a partir das atividades), StravaOAuthAttempt (tentativas de autorizacao) e StravaConnection
// (tokens). A ultima so' sai por ultimo: depois dela o sistema nao coleta mais nada deste usuario.

export type StravaDeletionResult = {
  activities: number;
  analysisCaches: number;
  executionInsights: number;
  oauthAttempts: number;
  connections: number;
};

interface Deleter { deleteMany(args: { where: Record<string, unknown> }): Promise<{ count: number }> }
export interface StravaDeletionClient {
  stravaActivity: Deleter;
  stravaAnalysisCache: Deleter;
  trainingExecutionInsight: Deleter;
  stravaOAuthAttempt: Deleter;
  stravaConnection: Deleter;
}

export async function deleteStravaData(db: StravaDeletionClient, userId: string): Promise<StravaDeletionResult> {
  const activities = await db.stravaActivity.deleteMany({ where: { userId } });
  const analysisCaches = await db.stravaAnalysisCache.deleteMany({ where: { userId } });
  const executionInsights = await db.trainingExecutionInsight.deleteMany({ where: { userId } });
  const oauthAttempts = await db.stravaOAuthAttempt.deleteMany({ where: { userId } });
  const connections = await db.stravaConnection.deleteMany({ where: { userId } });
  return {
    activities: activities.count,
    analysisCaches: analysisCaches.count,
    executionInsights: executionInsights.count,
    oauthAttempts: oauthAttempts.count,
    connections: connections.count,
  };
}
