import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { CreateObservationDto } from './dto/create-observation.dto';
import { ReportTimelineService } from '../reporter/report-timeline.service';
import { STUDENT_REPORT_SOURCE_TYPES } from '../reporter/report-timeline.constants';

@Injectable()
export class ObservationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly telegram: TelegramService,
    private readonly reportTimeline: ReportTimelineService,
  ) {}

  async listMine(userId: string) {
    return this.prisma.studentObservation.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
  }

  async create(userId: string, dto: CreateObservationDto) {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { name: true, email: true, studentCode: true } });
    const observation = await this.prisma.studentObservation.create({
      data: { userId, content: dto.content.trim() },
    });

    await this.telegram.notifyCoach(
      `Nova observacao registrada no Panzeri Run\n\nAluno: ${user.name} (Cod. ${formatStudentCode(user.studentCode)})\nE-mail: ${user.email}\nObservacao: ${observation.content}`,
    );

    // Auditoria Astra (29/09/2026), item 10 — CAUSA RAIZ: esta observacao e' 100% texto livre, sem
    // nenhum dado estruturado proprio. Registrar aqui via recordEvent() DIRETO e' redundante com o
    // que reportTimeline.record() ja aciona logo abaixo: quando o Agente Relator analisa este
    // mesmo texto e classifica relevance != PONTUAL, ele mesmo chama
    // studentProfile.recordEvent(STUDENT_REPORT_ANALYZED, ...) com o texto interpretado
    // (FATO/PERCEPCAO/HIPOTESES separados) — melhor estruturado que a linha crua que existia aqui.
    // Duas chamadas para o MESMO acontecimento faziam o Prontuario incorporar a mesma observacao
    // duas vezes (uma crua, sem interpretacao; outra via Relator, com interpretacao) — nunca uma
    // segunda evidencia independente do mesmo acontecimento (regra do circuito Relator->Prontuario,
    // 28/09/2026). O texto ORIGINAL continua preservado pra sempre na Timeline
    // (StudentReportEntry.originalText), independente do resultado da analise do Relator.
    void this.reportTimeline.record({
      userId,
      sourceType: STUDENT_REPORT_SOURCE_TYPES.STUDENT_OBSERVATION,
      sourceId: observation.id,
      promptQuestion: 'Escreva aqui o que quer avisar...',
      relatedLabel: 'Observacao registrada pelo aluno',
      originalText: observation.content,
      occurredAt: observation.createdAt,
    });

    return observation;
  }
}
