import { PrismaService } from '../prisma/prisma.service';

// Defesa de leitura contra analise de execucao DESATUALIZADA (15/10/2026).
// SessionExecutionAnalysis e' uma linha derivada: grava qual atividade estava vinculada a sessao quando foi calculada. Se o vinculo e' corrigido depois
// (desfeito, trocado, refeito) e o recalculo nao acontece (ou falha), a linha continua dizendo o que valia ANTES. Quem le essas linhas como evidencia
// atual (Analista, variaveis execution.*, relatorio da sessao) deve descartar as obsoletas — nunca reutiliza-las em silencio. O historico nao e'
// tocado: a linha continua no banco; ela so' deixa de ser tratada como evidencia atual ate ser recalculada.

export interface AnalysisRowRef {
  id: string;
  trainingSessionId: string;
  activityLogId: string | null;
}

/** Ids das linhas cuja atividade registrada NAO corresponde ao vinculo ativo atual da sessao (fail-closed: na duvida, obsoleta). */
export async function findStaleAnalysisRowIds(prisma: PrismaService, rows: AnalysisRowRef[]): Promise<Set<string>> {
  const stale = new Set<string>();
  if (rows.length === 0) return stale;

  const sessionIds = [...new Set(rows.map((row) => row.trainingSessionId))];
  const links = await prisma.sessionExecutionLink.findMany({
    where: { trainingSessionId: { in: sessionIds }, status: 'active' },
    select: { trainingSessionId: true, activityLogId: true },
  });
  const activityIds = [...new Set([...links.map((link) => link.activityLogId), ...rows.map((row) => row.activityLogId).filter((id): id is string => id != null)])];
  const activities = activityIds.length === 0
    ? []
    : await prisma.activityLog.findMany({ where: { id: { in: activityIds } }, select: { id: true, physicalEventId: true } });
  const eventOf = new Map(activities.map((activity) => [activity.id, activity.physicalEventId ?? null]));

  const linkedBySession = new Map<string, string[]>();
  for (const link of links) linkedBySession.set(link.trainingSessionId, [...(linkedBySession.get(link.trainingSessionId) ?? []), link.activityLogId]);

  for (const row of rows) {
    const linked = linkedBySession.get(row.trainingSessionId) ?? [];
    if (row.activityLogId == null) {
      if (linked.length > 0) stale.add(row.id); // a sessao ganhou atividade depois do calculo
      continue;
    }
    if (linked.length === 0) { stale.add(row.id); continue; } // a sessao perdeu o ultimo vinculo
    const rowEvent = eventOf.get(row.activityLogId) ?? null;
    const sameActivity = linked.includes(row.activityLogId);
    const sameEvent = rowEvent != null && linked.some((id) => eventOf.get(id) === rowEvent);
    if (!sameActivity && !sameEvent) stale.add(row.id); // vinculo trocado para outro evento fisico
  }
  return stale;
}

// ── Correcoes de vinculo posteriores a um retrato ENTREGUE (lote 3, 15/10/2026) ────────────────────────────────────────────────────────────────
// Os retratos entregues com um programa (TrainingAnalysis week/longitudinal) sao historicos e nunca sao reescritos. Mas uma REGENERACAO posterior nao pode
// usa-los como evidencia atual se algum vinculo que eles tocam foi criado/revogado depois. O proprio historico de vinculos (SessionExecutionLink) e' o registro
// da correcao: nenhuma tabela nova.

export interface LinkCorrection {
  linkId: string;
  acao: 'vinculo_criado' | 'vinculo_revogado';
  origem: string;
  quando: string;
  trainingSessionId: string;
  activityLogId: string;
  nota: string | null;
}

export interface SnapshotRef {
  id: string;
  createdAt: Date;
  evidence: { sessionIds: string[]; activityLogIds: string[] };
}

/** Por retrato: correcoes de vinculo ocorridas DEPOIS dele que tocam suas sessoes/atividades. So' le. Falha de leitura propaga (quem chama decide, fail-closed). */
export async function findCorrectionsAffecting(prisma: PrismaService, userId: string, snapshots: SnapshotRef[]): Promise<Map<string, LinkCorrection[]>> {
  const out = new Map<string, LinkCorrection[]>();
  if (snapshots.length === 0) return out;
  const earliest = new Date(Math.min(...snapshots.map((s) => s.createdAt.getTime())));
  const links = await prisma.sessionExecutionLink.findMany({
    where: { userId, OR: [{ createdAt: { gt: earliest } }, { revokedAt: { gt: earliest } }] },
    select: { id: true, trainingSessionId: true, activityLogId: true, origin: true, note: true, createdAt: true, revokedAt: true },
  });
  for (const snapshot of snapshots) {
    const sessions = new Set(snapshot.evidence.sessionIds);
    const activities = new Set(snapshot.evidence.activityLogIds);
    const entries: LinkCorrection[] = [];
    for (const l of links) {
      if (!sessions.has(l.trainingSessionId) && !activities.has(l.activityLogId)) continue;
      const base = { linkId: l.id, origem: l.origin, trainingSessionId: l.trainingSessionId, activityLogId: l.activityLogId, nota: l.note ?? null };
      if (l.createdAt > snapshot.createdAt) entries.push({ ...base, acao: 'vinculo_criado', quando: l.createdAt.toISOString() });
      if (l.revokedAt != null && l.revokedAt > snapshot.createdAt) entries.push({ ...base, acao: 'vinculo_revogado', quando: l.revokedAt.toISOString() });
    }
    out.set(snapshot.id, entries.sort((a, b) => a.quando.localeCompare(b.quando)));
  }
  return out;
}

/** Registro, no pacote de evidencias, de como as correcoes foram tratadas na regeneracao (rastreabilidade; nunca altera o retrato historico). */
export interface AnalysisCorrectionRecord {
  // true = a evidencia enviada ao Prescritor foi RECALCULADA para leitura com os vinculos atuais; false = o retrato antigo foi retirado e nada foi enviado no lugar.
  recalculatedForRead: boolean;
  motivo: string;
  retratosEntregues: string[];
  correcoes: LinkCorrection[];
  // Sessoes/atividades tocadas pelas correcoes que ainda constam da evidencia ATUAL enviada, e as que deixaram de constar.
  usadasNaEvidenciaAtual: { sessionIds: string[]; activityLogIds: string[] };
  retiradasDaEvidencia: { sessionIds: string[]; activityLogIds: string[] };
}
