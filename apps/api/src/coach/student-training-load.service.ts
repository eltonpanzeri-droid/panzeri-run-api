import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingIntelligenceQueryService } from '../training-intelligence/training-intelligence-query.service';
import { buildSessionReferences } from '../training-intelligence/internal-load-context';
import { parseDay, validatePeriod } from './health-recovery';
import { addDays, buildTrainingLoad, classifySessions, type TrainingLoadResult } from './training-load';
import { loadInputRows, activityLocalDate as rowsActivityLocalDate } from './training-load-rows';

// Painel do treinador > Aluno > Evolução > Carga interna percebida (era "Carga (própria)", 23/10/2026; consolidada em 01/11/2026). SOMENTE LEITURA. Os registros (treino feito, PSE, duração, atividade vinculada)
// vêm de training-load-rows.ts — a MESMA fonte que alimenta o Explorar e o contexto da IA: o painel nunca recalcula a métrica por conta própria. Aqui só se monta o período, as janelas de 7 e 28 dias
// (training-load.ts) e a comparação da sessão mais recente de cada modalidade com o histórico ANTERIOR a ela (reference-series.ts, via Training Intelligence; internal-load-context.ts).
export { rowsActivityLocalDate as activityLocalDate };

const spToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

@Injectable()
export class StudentTrainingLoadService {
  // `ti` é opcional só para testes que constroem o serviço sem o Nest; no app o módulo sempre injeta.
  constructor(private readonly prisma: PrismaService, @Optional() private readonly ti?: TrainingIntelligenceQueryService) {}

  async forStudent(studentId: string, query: { from?: string; to?: string }): Promise<TrainingLoadResult> {
    const exists = await this.prisma.user.findUnique({ where: { id: studentId }, select: { id: true } });
    if (!exists) throw new NotFoundException('Aluno nao encontrado.');
    const today = spToday();
    const parsed = (value: string | undefined, label: string) => {
      if (value === undefined || value === '') return null;
      const day = parseDay(value);
      if (!day) throw new BadRequestException(`Data inválida em ${label}. Use o formato AAAA-MM-DD.`);
      return day;
    };
    const requestedTo = parsed(query.to, 'data final') ?? today;
    const to = requestedTo > today ? today : requestedTo; // nao ha carga no futuro: o periodo termina, no maximo, hoje
    const from = parsed(query.from, 'data inicial') ?? addDays(to, -83); // 12 semanas por padrão
    const problem = validatePeriod(from, to);
    if (problem) throw new BadRequestException(problem);

    const rows = await loadInputRows(this.prisma, studentId);
    const result = buildTrainingLoad(rows, { from, to }, today);
    const references = await buildSessionReferences(this.ti, studentId, classifySessions(rows).sessions);
    return references ? { ...result, references } : result;
  }
}
