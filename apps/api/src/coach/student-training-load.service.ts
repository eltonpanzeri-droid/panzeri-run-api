import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { parseDay, validatePeriod } from './health-recovery';
import { addDays, buildTrainingLoad, type LoadInputRow, type TrainingLoadResult } from './training-load';

// Painel do treinador > Aluno > Carga (própria) (23/10/2026). SOMENTE LEITURA: lê os registros de treino que a aluna já informou (esforço percebido e duração) e devolve a carga calculada
// com TODA a conta à vista (ver training-load.ts). Não usa relógio, não grava nada e não alimenta o Atlas.
const spToday = () => new Date().toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });
const isoDay = (value: Date) => value.toISOString().slice(0, 10);
const spDay = (value: Date) => value.toLocaleDateString('en-CA', { timeZone: 'America/Sao_Paulo' });

@Injectable()
export class StudentTrainingLoadService {
  constructor(private readonly prisma: PrismaService) {}

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

    const completions = await this.prisma.workoutCompletion.findMany({
      where: { userId: studentId, status: { in: ['done', 'adjusted'] } },
      orderBy: { completedAt: 'asc' },
      select: { id: true, completedAt: true, status: true, durationMin: true, perceivedEffort: true, session: { select: { scheduledDate: true, modality: true, title: true, structure: true } } },
    });
    const rows: LoadInputRow[] = completions.map((c) => {
      const structure = (c.session?.structure ?? null) as { source?: unknown; type?: unknown } | null;
      return {
        id: c.id,
        date: c.session?.scheduledDate ? isoDay(c.session.scheduledDate) : spDay(c.completedAt),
        modality: c.session?.modality ?? null,
        title: c.session?.title ?? null,
        status: c.status,
        durationMin: c.durationMin,
        perceivedEffort: c.perceivedEffort,
        isExtra: structure?.source === 'student' && structure?.type === 'extra', // mesma deteccao de sessao extra usada na evolucao
      };
    });
    return buildTrainingLoad(rows, { from, to }, today);
  }
}
