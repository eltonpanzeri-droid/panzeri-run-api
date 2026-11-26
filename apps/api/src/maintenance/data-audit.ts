/* eslint-disable no-console */
import { PrismaClient } from '@prisma/client';
import { canonicalModality, isRunModality } from '../activity-execution/canonical-modality';
import { NORMALIZATION_VERSION } from '../activity-timeseries/activity-timeseries.service';

// Auditoria SO' DE LEITURA (26/11/2026, ordem de Elton): confere, por aluno, se os dados do relogio estao chegando e sendo lidos como deveriam.
// ai-scope: nao-ia (auditoria interna de qualidade de dados; nada daqui vai para a IA e nada e' gravado).
//   node dist/maintenance/data-audit.js                    (todos os alunos: resumo + so' quem tem algo a conferir)
//   node dist/maintenance/data-audit.js --code=11          (um aluno, pelo codigo de 7 digitos sem os zeros)
// A saida usa SO' o codigo do aluno (nunca nome, e-mail ou CPF) para poder ser colada no chat.
//   - modalidades BRUTAS do provedor (RUNNING, OTHER...) que sobraram no historico;
//   - corridas SEM serie por segundo gravada;
//   - corridas COM cadencia na serie mas cadenceAvg VAZIO (o indicador "cadencia" fica sem registros por isso);
//   - corridas COM serie mas sem cadencia nenhuma (o aparelho/integracao nao entregou);
//   - corridas sem FC media.
const CHUNK = 500;

async function main() {
  const codeArg = process.argv.find((arg) => arg.startsWith('--code='));
  const onlyCode = codeArg ? Number(codeArg.split('=')[1]) : null;
  const prisma = new PrismaClient();
  try {
    const users = await prisma.user.findMany({
      where: { studentCode: onlyCode != null ? onlyCode : { not: null } },
      select: { id: true, studentCode: true },
    });
    const codeOf = new Map(users.map((user) => [user.id, user.studentCode as number]));
    const logs = await prisma.activityLog.findMany({
      where: { userId: { in: users.map((user) => user.id) } },
      select: { id: true, userId: true, provider: true, sport: true, cadenceAvg: true, avgHeartRateBpm: true },
    });
    const runIds = logs.filter((log) => isRunModality(log.sport)).map((log) => log.id);
    const pointCount = new Map<string, number>();
    const cadencePointCount = new Map<string, number>();
    for (let i = 0; i < runIds.length; i += CHUNK) {
      const ids = runIds.slice(i, i + CHUNK);
      const all = await prisma.activityTimeSeriesPoint.groupBy({ by: ['activityLogId'], where: { activityLogId: { in: ids }, normalizationVersion: NORMALIZATION_VERSION }, _count: { _all: true } });
      for (const row of all) pointCount.set(row.activityLogId, row._count._all);
      const withCadence = await prisma.activityTimeSeriesPoint.groupBy({ by: ['activityLogId'], where: { activityLogId: { in: ids }, normalizationVersion: NORMALIZATION_VERSION, cadenceSpm: { gt: 0 } }, _count: { _all: true } });
      for (const row of withCadence) cadencePointCount.set(row.activityLogId, row._count._all);
    }

    type Row = { activities: number; runs: number; noSeries: number; cadenceEmptyButInSeries: number; seriesWithoutCadence: number; noAvgHr: number; rawSports: Map<string, number>; providers: Map<string, number> };
    const perUser = new Map<string, Row>();
    const rowOf = (userId: string): Row => {
      let row = perUser.get(userId);
      if (!row) { row = { activities: 0, runs: 0, noSeries: 0, cadenceEmptyButInSeries: 0, seriesWithoutCadence: 0, noAvgHr: 0, rawSports: new Map(), providers: new Map() }; perUser.set(userId, row); }
      return row;
    };
    for (const log of logs) {
      const row = rowOf(log.userId);
      row.activities += 1;
      row.providers.set(log.provider, (row.providers.get(log.provider) ?? 0) + 1);
      const raw = typeof log.sport === 'string' ? log.sport.trim() : '';
      if (raw && canonicalModality(raw) !== raw.toLowerCase()) row.rawSports.set(raw, (row.rawSports.get(raw) ?? 0) + 1);
      if (!isRunModality(log.sport)) continue;
      row.runs += 1;
      const points = pointCount.get(log.id) ?? 0;
      if (points === 0) row.noSeries += 1;
      else if ((cadencePointCount.get(log.id) ?? 0) > 0 && (log.cadenceAvg == null || log.cadenceAvg <= 0)) row.cadenceEmptyButInSeries += 1;
      else if ((cadencePointCount.get(log.id) ?? 0) === 0) row.seriesWithoutCadence += 1;
      if (log.avgHeartRateBpm == null || log.avgHeartRateBpm <= 0) row.noAvgHr += 1;
    }

    const total = { students: perUser.size, activities: 0, runs: 0, noSeries: 0, cadenceEmptyButInSeries: 0, seriesWithoutCadence: 0, noAvgHr: 0 };
    const lines: string[] = [];
    for (const [userId, row] of [...perUser.entries()].sort((a, b) => (codeOf.get(a[0]) ?? 0) - (codeOf.get(b[0]) ?? 0))) {
      total.activities += row.activities; total.runs += row.runs; total.noSeries += row.noSeries;
      total.cadenceEmptyButInSeries += row.cadenceEmptyButInSeries; total.seriesWithoutCadence += row.seriesWithoutCadence; total.noAvgHr += row.noAvgHr;
      const issues = row.rawSports.size > 0 || row.cadenceEmptyButInSeries > 0 || row.noSeries > 0 || row.noAvgHr > 0 || row.seriesWithoutCadence > 0;
      if (!issues && onlyCode == null) continue;
      const code = String(codeOf.get(userId) ?? 0).padStart(7, '0');
      const raws = [...row.rawSports.entries()].map(([sport, n]) => `${sport}x${n}`).join(', ') || '-';
      const providers = [...row.providers.entries()].map(([provider, n]) => `${provider}x${n}`).join(', ');
      lines.push(`Cod. ${code} | atividades ${row.activities} (${providers}) | corridas ${row.runs} | sem serie ${row.noSeries} | cadencia vazia COM cadencia na serie ${row.cadenceEmptyButInSeries} | serie SEM cadencia ${row.seriesWithoutCadence} | sem FC media ${row.noAvgHr} | modalidades brutas: ${raws}`);
    }
    console.log(`RESUMO: ${total.students} aluno(s) com atividades | ${total.activities} atividades | ${total.runs} corridas | sem serie ${total.noSeries} | cadencia vazia COM cadencia na serie ${total.cadenceEmptyButInSeries} | serie SEM cadencia ${total.seriesWithoutCadence} | sem FC media ${total.noAvgHr}`);
    for (const line of lines) console.log(line);
    console.log('Nada foi alterado (auditoria so de leitura).');
  } finally {
    await prisma.$disconnect();
  }
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
