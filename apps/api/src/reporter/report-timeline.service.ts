import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { StudentReporterAgentService, PriorReportEntryForContext } from './student-reporter-agent.service';

// Quantos relatos anteriores do MESMO aluno entram no contexto de "conexao longitudinal" (item 3.E
// do pedido: "nao precisa reler indefinidamente todo o historico bruto"). Numero pequeno de
// proposito — o objetivo e dar continuidade recente, nao reconstruir a jornada inteira aqui (isso
// e papel do futuro Agente de Prontuario).
const PRIOR_ENTRIES_CONTEXT_LIMIT = 15;

export interface RecordReportEntryInput {
  userId: string;
  sourceType: string;
  sourceId?: string | null;
  promptQuestion?: string | null;
  relatedLabel?: string | null;
  originalText: string | null | undefined;
  occurredAt: Date;
}

@Injectable()
export class ReportTimelineService {
  private readonly logger = new Logger(ReportTimelineService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly relatorAgent: StudentReporterAgentService,
  ) {}

  // Chamado pelos pontos reais do sistema onde o aluno escreve texto livre, logo APOS o dado
  // original ja ter sido salvo com sucesso (nunca dentro da mesma transacao — grava rapido, sem IA,
  // e dispara a analise em segundo plano sem bloquear quem chamou). Todo texto vazio/so espaco e
  // ignorado: ausencia de texto nao e um relato.
  async record(input: RecordReportEntryInput): Promise<void> {
    const text = (input.originalText ?? '').trim();
    if (!text) return;

    try {
      const entry = await this.prisma.studentReportEntry.create({
        data: {
          userId: input.userId,
          sourceType: input.sourceType,
          sourceId: input.sourceId ?? null,
          promptQuestion: input.promptQuestion ?? null,
          relatedLabel: input.relatedLabel ?? null,
          originalText: text,
          occurredAt: input.occurredAt,
        },
      });
      void this.analyzeEntry(entry.id).catch((error) => {
        this.logger.warn(`Falha ao disparar analise do relato ${entry.id}: ${(error as Error).message}`);
      });
    } catch (error) {
      // Nunca deixa a Linha do Tempo derrubar o fluxo real (salvar feedback/dor/check-in etc.) —
      // best-effort, mesmo padrao de robustez ja usado nos outros agentes desta arquitetura.
      this.logger.warn(`Falha ao registrar relato na timeline (sourceType=${input.sourceType}): ${(error as Error).message}`);
    }
  }

  async analyzeEntry(entryId: string): Promise<void> {
    const entry = await this.prisma.studentReportEntry.findUnique({ where: { id: entryId } });
    if (!entry) return;

    const [user, priorRows] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: entry.userId }, select: { name: true } }),
      this.prisma.studentReportEntry.findMany({
        where: { userId: entry.userId, id: { not: entry.id } },
        orderBy: { occurredAt: 'desc' },
        take: PRIOR_ENTRIES_CONTEXT_LIMIT,
        select: { occurredAt: true, sourceType: true, originalText: true, themes: true, relevance: true },
      }),
    ]);

    const priorEntries: PriorReportEntryForContext[] = priorRows.map((row) => ({
      occurredAt: row.occurredAt.toISOString(),
      sourceType: row.sourceType,
      originalText: row.originalText,
      themes: row.themes,
      relevance: row.relevance,
    }));

    const result = await this.relatorAgent.analyze({
      studentName: user?.name ?? 'Aluno',
      sourceType: entry.sourceType,
      promptQuestion: entry.promptQuestion,
      relatedLabel: entry.relatedLabel,
      occurredAt: entry.occurredAt.toISOString(),
      originalText: entry.originalText,
      priorEntries,
    });

    if (!result) {
      await this.prisma.studentReportEntry.update({
        where: { id: entry.id },
        data: { analysisError: 'Analise indisponivel (IA nao configurada ou chamada falhou).' },
      });
      return;
    }

    await this.prisma.studentReportEntry.update({
      where: { id: entry.id },
      data: {
        analyzedAt: new Date(),
        facts: result.facts,
        perception: result.perception,
        themes: result.themes,
        temporality: result.temporality,
        longitudinalNote: result.longitudinalNote,
        hypotheses: result.hypotheses,
        relevance: result.relevance,
        analysisError: null,
      },
    });
  }
}
