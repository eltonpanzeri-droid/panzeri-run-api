import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '@nestjs/config';
import { UpsertWorkoutCompletionDto } from './dto/upsert-workout-completion.dto';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { ContextEventsService } from '../context-events/context-events.service';
import { ReportTimelineService } from '../reporter/report-timeline.service';
import { STUDENT_REPORT_SOURCE_TYPES } from '../reporter/report-timeline.constants';
import { MedalEvaluationService } from '../medals/medal-evaluation.service';

@Injectable()
export class WorkoutCompletionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly studentProfile: StudentProfileService,
    private readonly telegram: TelegramService,
    private readonly contextEvents: ContextEventsService,
    private readonly reportTimeline: ReportTimelineService,
    private readonly medalEvaluation: MedalEvaluationService,
  ) {}

  async upsert(userId: string, dto: UpsertWorkoutCompletionDto) {
    const details = (dto.details ?? {}) as Prisma.InputJsonObject;
    const session = await this.prisma.trainingSession.findFirst({
      where: {
        id: dto.sessionId,
        userId,
      },
    });

    if (!session) {
      throw new NotFoundException('Treino nao encontrado.');
    }

    // Feedback de Atividade Alternativa (02/10/2026) — a sessao e' sintetica (materializada por
    // SessionExecutionLinkService.materializeExtraActivity a partir de uma ActivityLog
    // 'alternative'), NUNCA uma prescricao real do treinador. "Em relacao ao prescrito, como foi
    // sua execucao?" nao faz sentido aqui — nao ha' prescricao nenhuma pra comparar. Mesmo
    // mecanismo de upsert/validacao do Feedback V3 pra tudo mais (esforco, fadiga, humor, dor,
    // sono/estresse compartilhados) — nao e' um formulario novo, so' esta pergunta especifica fica
    // de fora.
    const isAlternativeSession = session.origin === 'device_extra';

    if (dto.status === 'done' && !dto.perceivedEffort) {
      throw new BadRequestException('Informe o esforco percebido de 1 a 10.');
    }

    // 24/09: feedback v2 — 16 perguntas reestruturadas (blocos Sono/Estado antes/Resposta ao
    // treino), pedido explicito do treinador. Mesmo padrao de deteccao por presenca de campo usado
    // desde a v1 (ver isV1Client abaixo): um cliente v2 e' reconhecido por mandar qualquer um dos
    // campos que so existem na v2. Clientes v1 (app ainda nao atualizado) continuam funcionando
    // exatamente como antes — nada aqui muda o comportamento pra eles.
    const isV2Client =
      dto.sleepDurationCategory !== undefined ||
      dto.bedtimeShiftDirection !== undefined ||
      dto.wakeTimeShiftDirection !== undefined ||
      dto.sleepInterruption !== undefined ||
      dto.sleepDifficulty !== undefined ||
      dto.preMentalFatigue !== undefined ||
      dto.executionVsPrescribed !== undefined ||
      dto.postPhysicalFatigue !== undefined ||
      dto.postMentalFatigue !== undefined ||
      dto.emotionalExperienceDuring !== undefined ||
      dto.mentalStateChangePrePost !== undefined;

    // 01/10/2026 (2): feedback v3 — executionBehavior substitui executionVsPrescribed (pergunta
    // comportamental/categorica, nao mais escala ordinal de desvio quantitativo). Mesmo padrao de
    // deteccao por presenca de campo. Nunca reaproveita a coluna antiga: ver nota em schema.prisma.
    const isV3Client = dto.executionBehavior !== undefined;

    // Feedback v1: bloco 1 obrigatorio para done e adjusted.
    // Compatibilidade retroativa (12/09): clientes antigos (Play Store pre-v1) nao enviam nenhum
    // campo de pre-treino. So' aplicamos a validacao completa quando ao menos um deles veio —
    // o que indica um cliente novo que conhece esses campos. Clientes antigos passam sem eles.
    const isV1Client =
      dto.preSleepQuality !== undefined ||
      dto.prePhysicalFatigue !== undefined ||
      dto.preStressLevel !== undefined ||
      dto.preMotivation !== undefined;
    if (isV1Client && (dto.status === 'done' || dto.status === 'adjusted') &&
        (!dto.preSleepQuality || !dto.prePhysicalFatigue || !dto.preStressLevel || !dto.preMotivation)) {
      throw new BadRequestException('Preencha todas as perguntas do bloco "Como voce chegou".');
    }
    if (isV2Client && (dto.status === 'done' || dto.status === 'adjusted')) {
      if (!dto.sleepDurationCategory || !dto.bedtimeShiftDirection || !dto.wakeTimeShiftDirection || !dto.sleepInterruption || !dto.sleepDifficulty) {
        throw new BadRequestException('Preencha todas as perguntas do bloco "Sono".');
      }
      if (!dto.preMentalFatigue) {
        throw new BadRequestException('Preencha todas as perguntas do bloco "Estado antes do treino".');
      }
      // executionBehavior (v3) substitui executionVsPrescribed (v2) — exige um ou outro conforme
      // o cliente, nunca os dois; nunca aceita os dois faltando. Atividade alternativa e' a UNICA
      // excecao: nao ha' prescricao pra comparar, entao a pergunta simplesmente nao se aplica
      // (nunca preenchida automaticamente — ver forcamento pra null mais abaixo, no upsert em si).
      if (!isAlternativeSession && (isV3Client ? !dto.executionBehavior : !dto.executionVsPrescribed)) {
        throw new BadRequestException('Informe como foi sua execucao em relacao ao prescrito.');
      }
      if (!dto.postPhysicalFatigue || !dto.postMentalFatigue ||
          !dto.emotionalExperienceDuring || !dto.mentalStateChangePrePost) {
        throw new BadRequestException('Preencha todas as perguntas do bloco "Resposta ao treino".');
      }
    }
    // satisfactionElaboracao (pergunta 11) e' obrigatoria em v1 E v2 — mantida sem mudanca.
    // satisfactionCapacidade (pergunta antiga "execucao") deixou de ser coletada a partir da v2,
    // substituida por executionVsPrescribed (validado acima) — so' exigida em clientes v1/pre-v1.
    // postWorkoutFeeling (pergunta antiga "corpo ao terminar") idem: so' exigida quando NAO e' v2
    // (na v2 quem cobre isso e' postPhysicalFatigue, ja validado acima). Atividade alternativa
    // tambem fica de fora de satisfactionElaboracao — "elaboracao do treino" se refere a' qualidade
    // da prescricao do treinador, que nao existe aqui.
    if ((dto.status === 'done' || dto.status === 'adjusted') &&
        ((!isAlternativeSession && !dto.satisfactionElaboracao) || (!isV2Client && !dto.satisfactionCapacidade) || (isV1Client && !isV2Client && !dto.postWorkoutFeeling))) {
      throw new BadRequestException('Preencha todas as perguntas do bloco "Como foi o treino".');
    }
    if ((dto.status === 'done' || dto.status === 'adjusted') && !dto.painFlag) {
      throw new BadRequestException('Informe se sentiu dor ou desconforto no treino.');
    }
    if (dto.painFlag && dto.painFlag !== 'none' && !dto.painTiming) {
      throw new BadRequestException('Informe quando a dor ou desconforto apareceu.');
    }

    const previous = await this.prisma.workoutCompletion.findUnique({ where: { sessionId: dto.sessionId } });

    // 01/10/2026: sono pertence a NOITE (userId+dia do treino), estresse pertence a uma JANELA
    // MOVEL de 24h com timestamp real — nenhum dos dois e mais "por sessao". Resolvidos ANTES do
    // completion em si pra podermos gravar o vinculo (nightlySleepLogId/stressCheckinId) no mesmo
    // upsert. As colunas proprias do completion (preSleepQuality etc.) continuam gravadas logo
    // abaixo, como copia desnormalizada — Admin/Telegram/prontuario nao mudam; so' a Training
        // Intelligence passa a ler exclusivamente da tabela compartilhada (ver observation-reader).
    const nightlySleepLogId = await this.resolveNightlySleepLog(userId, session.scheduledDate, dto);
    const stressCheckinId = await this.resolveStressCheckin(userId, dto, previous?.stressCheckinId ?? null);

    const completedAt = dto.completedAt ? new Date(dto.completedAt) : undefined;
    const completion = await this.prisma.workoutCompletion.upsert({
      where: { sessionId: dto.sessionId },
      create: {
        userId,
        sessionId: dto.sessionId,
        status: dto.status,
        completedAt,
        durationMin: dto.durationMin,
        distanceKm: dto.distanceKm,
        avgPaceSecondsKm: dto.avgPaceSecondsKm,
        avgHeartRate: dto.avgHeartRate,
        maxHeartRate: dto.maxHeartRate,
        perceivedEffort: dto.perceivedEffort,
        satisfaction: dto.satisfaction,
        // Atividade alternativa nunca grava elaboracao/execucao-vs-prescrito — nao ha' prescricao
        // pra' essas perguntas se referirem. Forcado aqui (nao so' na validacao) pra' garantir que
        // nenhum cliente consiga gravar valor nessas colunas pra uma sessao sintetica, mesmo que
        // o dto venha com algo preenchido por engano.
        satisfactionElaboracao: isAlternativeSession ? null : dto.satisfactionElaboracao,
        satisfactionCapacidade: dto.satisfactionCapacidade,
        satisfactionCarga: dto.satisfactionCarga,
        painFlag: dto.painFlag,
        preSleepQuality: dto.preSleepQuality,
        prePhysicalFatigue: dto.prePhysicalFatigue,
        preStressLevel: dto.preStressLevel,
        preMotivation: dto.preMotivation,
        postWorkoutFeeling: dto.postWorkoutFeeling,
        painTiming: dto.painTiming,
        sleepDurationCategory: dto.sleepDurationCategory,
        sleepDurationHoursEstimate: sleepDurationHoursEstimate(dto.sleepDurationCategory),
        sleepInterruption: dto.sleepInterruption,
        sleepDifficulty: dto.sleepDifficulty,
        nightlySleepLogId,
        stressCheckinId,
        preMentalFatigue: dto.preMentalFatigue,
        executionVsPrescribed: isAlternativeSession ? null : dto.executionVsPrescribed,
        executionBehavior: isAlternativeSession ? null : dto.executionBehavior,
        postPhysicalFatigue: dto.postPhysicalFatigue,
        postMentalFatigue: dto.postMentalFatigue,
        emotionalExperienceDuring: dto.emotionalExperienceDuring,
        mentalStateChangePrePost: dto.mentalStateChangePrePost,
        feedbackVersion: isV3Client ? 3 : isV2Client ? 2 : 1,
        notes: dto.notes,
        details,
        source: 'manual',
        adjustmentReasons: dto.adjustmentReasons ?? [],
        adjustmentComment: dto.adjustmentComment,
        adjustmentPreferredActivity: dto.adjustmentPreferredActivity,
      },
      update: {
        status: dto.status,
        completedAt,
        durationMin: dto.durationMin,
        distanceKm: dto.distanceKm,
        avgPaceSecondsKm: dto.avgPaceSecondsKm,
        avgHeartRate: dto.avgHeartRate,
        maxHeartRate: dto.maxHeartRate,
        perceivedEffort: dto.perceivedEffort,
        satisfaction: dto.satisfaction,
        satisfactionElaboracao: isAlternativeSession ? null : dto.satisfactionElaboracao,
        satisfactionCapacidade: dto.satisfactionCapacidade,
        satisfactionCarga: dto.satisfactionCarga,
        painFlag: dto.painFlag,
        preSleepQuality: dto.preSleepQuality,
        prePhysicalFatigue: dto.prePhysicalFatigue,
        preStressLevel: dto.preStressLevel,
        preMotivation: dto.preMotivation,
        postWorkoutFeeling: dto.postWorkoutFeeling,
        painTiming: dto.painTiming,
        sleepDurationCategory: dto.sleepDurationCategory,
        sleepDurationHoursEstimate: sleepDurationHoursEstimate(dto.sleepDurationCategory),
        sleepInterruption: dto.sleepInterruption,
        sleepDifficulty: dto.sleepDifficulty,
        nightlySleepLogId,
        stressCheckinId,
        preMentalFatigue: dto.preMentalFatigue,
        executionVsPrescribed: isAlternativeSession ? null : dto.executionVsPrescribed,
        executionBehavior: isAlternativeSession ? null : dto.executionBehavior,
        postPhysicalFatigue: dto.postPhysicalFatigue,
        postMentalFatigue: dto.postMentalFatigue,
        emotionalExperienceDuring: dto.emotionalExperienceDuring,
        mentalStateChangePrePost: dto.mentalStateChangePrePost,
        // Se o reenvio (edicao de feedback ja enviado) agora trouxer campos v2/v3, promove a
        // versao — nunca rebaixa uma sessao que ja era v2/v3 de volta so' porque o campo veio
        // undefined (ex.: reenvio parcial de um campo isolado).
        ...(isV3Client ? { feedbackVersion: 3 } : isV2Client ? { feedbackVersion: 2 } : {}),
        notes: dto.notes,
        details,
        source: 'manual',
        adjustmentReasons: dto.adjustmentReasons ?? [],
        adjustmentComment: dto.adjustmentComment,
        adjustmentPreferredActivity: dto.adjustmentPreferredActivity,
      },
    });

    if (dto.status === 'done' || dto.status === 'adjusted') {
      void this.maybeRecordFirstCompleted(userId, session.id);
    }

    // Passo 4 (25/09/2026): so' na CRIACAO (nunca num reenvio/edicao de feedback ja existente) de
    // uma execucao real, tenta vincular como "primeira observacao apos a lacuna" — ver
    // ContextEventsService.linkFirstObservationIfPending. Nunca bloqueia o salvamento do feedback.
    if (!previous && (dto.status === 'done' || dto.status === 'adjusted')) {
      void this.contextEvents.linkFirstObservationIfPending(userId, completion.id, completion.completedAt).catch(() => undefined);
    }

    // Data formatada usada tanto no Telegram de mismatch quanto na notificacao de painel do treinador.
    // scheduledDate e meia-noite UTC — usar 'UTC' evita o deslocamento de -3h que fazia a data
    // aparecer como o dia anterior no Telegram (mesmo fix ja aplicado em training-plans.service.ts).
    const dataFormatada = session.scheduledDate.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'UTC' });
    const weekdayAbrev = session.scheduledDate.toLocaleDateString('pt-BR', { weekday: 'short', timeZone: 'UTC' });

    // Sessao foi marcada em generateWeek() como fora da rotina/tempo combinado (sem diretriz que
    // explique) — pedido explicito do treinador 03/08: quando o aluno registra o feedback desse
    // treino especifico, encaminha pro Telegram do treinador junto com o motivo do desvio, alem
    // do aviso ja recebido na hora da geracao (routineMismatch agregado da semana).
    // 14/09: mensagem expandida para incluir todas as respostas do feedback (RPE, escalas, etc.)
    if (session.routineMismatchNote) {
      const student = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true, studentCode: true } });
      const statusLabel = dto.status === 'done' ? 'concluiu' : dto.status === 'adjusted' ? 'fez com ajustes' : 'marcou como nao feito';

      // Extrair campos que ficam em details (sem migration propria)
      const detailsMap = (dto.details ?? {}) as Record<string, unknown>;
      const postWorkoutMood = typeof detailsMap.postWorkoutMood === 'number' ? detailsMap.postWorkoutMood : null;
      const walkingReasons = Array.isArray(detailsMap.walkingReasons)
        ? (detailsMap.walkingReasons as unknown[]).filter((v): v is string => typeof v === 'string')
        : [];
      const pacingMode = typeof detailsMap.pacingMode === 'string' ? detailsMap.pacingMode : null;

      // Bloco de execucao (duracao, distancia, pace)
      const execParts: string[] = [];
      if (dto.durationMin) execParts.push(`${dto.durationMin}min`);
      if (dto.distanceKm) execParts.push(`${dto.distanceKm}km`);
      if (dto.avgPaceSecondsKm) execParts.push(`${Math.floor(dto.avgPaceSecondsKm / 60)}:${String(dto.avgPaceSecondsKm % 60).padStart(2, '0')}/km`);

      // Bloco pre-treino (Sono + Estado antes). Nas sessoes v2 (executionVsPrescribed presente ou
      // qualquer campo v2) usa os novos rotulos de intensidade; sessoes v1 mantem a leitura antiga
      // dos mesmos campos preSleepQuality/prePhysicalFatigue/preStressLevel/preMotivation.
      const preLines: string[] = [];
      if (dto.preSleepQuality) preLines.push(`😴 Qualidade do sono: ${dto.preSleepQuality}/5`);
      if (dto.sleepDurationCategory) preLines.push(`⏰ Duracao do sono: ${sleepDurationCategoryLabel(dto.sleepDurationCategory)}`);
      if (dto.bedtimeShiftDirection) preLines.push(`📆 Horario de dormir: ${sleepShiftLabel(dto.bedtimeShiftDirection)}`);
      if (dto.wakeTimeShiftDirection) preLines.push(`⏰ Horario de acordar: ${sleepShiftLabel(dto.wakeTimeShiftDirection)}`);
      if (dto.stressEventFrequency) preLines.push(`😰 Frequencia de estresse (24h): ${dto.stressEventFrequency}/5`);
      if (dto.sleepInterruption) preLines.push(`🌙 Sono interrompido: ${dto.sleepInterruption}/5`);
      if (dto.sleepDifficulty) preLines.push(`😵 Dificuldade pra dormir: ${dto.sleepDifficulty}/5`);
      if (dto.prePhysicalFatigue) preLines.push(`🦵 Cansaco fisico pre: ${dto.prePhysicalFatigue}/5`);
      if (dto.preMentalFatigue) preLines.push(`🧠 Cansaco mental pre: ${dto.preMentalFatigue}/5`);
      if (dto.preStressLevel) preLines.push(`😰 Estresse (ultimas 24h): ${dto.preStressLevel}/5`);
      if (dto.preMotivation) preLines.push(`🔥 Vontade de treinar: ${dto.preMotivation}/5`);

      // Bloco durante/pos (Resposta ao treino)
      const posLines: string[] = [];
      if (dto.perceivedEffort) posLines.push(`💪 RPE: ${dto.perceivedEffort}/10`);
      if (dto.satisfactionElaboracao) posLines.push(`📋 Elaboracao do treino: ${satisfactionLabel(dto.satisfactionElaboracao)}`);
      if (dto.executionBehavior) posLines.push(`🎯 Execucao em relacao ao prescrito: ${executionBehaviorLabel(dto.executionBehavior)}`);
      else if (dto.executionVsPrescribed) posLines.push(`🎯 Execucao vs. prescrito: ${executionVsPrescribedLabel(dto.executionVsPrescribed)}`);
      else if (dto.satisfactionCapacidade) posLines.push(`🏃 Como se saiu na execucao: ${satisfactionLabel(dto.satisfactionCapacidade)}`);
      if (dto.postPhysicalFatigue) posLines.push(`🦵 Cansaco fisico provocado: ${dto.postPhysicalFatigue}/5`);
      else if (dto.postWorkoutFeeling) posLines.push(`😊 Corpo ao terminar: ${dto.postWorkoutFeeling}/5`);
      if (dto.postMentalFatigue) posLines.push(`🧠 Cansaco mental provocado: ${dto.postMentalFatigue}/5`);
      if (dto.emotionalExperienceDuring) posLines.push(`❤️ Experiencia emocional durante: ${dto.emotionalExperienceDuring}/5`);
      else if (postWorkoutMood !== null) posLines.push(`❤️ Emocao ao terminar: ${postWorkoutMood}/5`);
      if (dto.mentalStateChangePrePost) posLines.push(`🔄 Mudanca mental pre→pos: ${dto.mentalStateChangePrePost}/5`);

      // Caminhou/parou
      if (pacingMode && pacingMode !== 'correu_tudo') {
        if (walkingReasons.length) {
          posLines.push(`🚶 Caminhou/parou: ${walkingReasons.map(walkingReasonLabel).join('; ')}`);
        } else {
          posLines.push(`🚶 Caminhou/parou durante o treino`);
        }
      } else if (pacingMode === 'correu_tudo') {
        posLines.push(`✅ Correu tudo sem caminhar/parar`);
      }

      // Dor
      if (dto.painFlag && dto.painFlag !== 'none') {
        const dor = `🩹 Dor: ${painFlagLabel(dto.painFlag)}${dto.painTiming ? ` — ${painTimingLabel(dto.painTiming)}` : ''}`;
        posLines.push(dor);
      }

      // Montagem da mensagem final
      const linhas: string[] = [
        `📋 Feedback — treino fora da rotina.`,
        `👤 ${student?.name ?? 'desconhecido'} (Cod. ${student ? formatStudentCode(student.studentCode) : '?'})`,
        `🗓 ${session.title} (${session.modality}) — ${weekdayAbrev} ${dataFormatada}`,
        `⚠️ Desvio: ${session.routineMismatchNote}`,
        `Status: Aluno ${statusLabel} este treino.`,
      ];
      if (execParts.length) linhas.push(`⏱ ${execParts.join(' | ')}`);
      if (preLines.length) {
        linhas.push('');
        linhas.push('PRE-TREINO');
        linhas.push(preLines.join('  '));
      }
      if (posLines.length) {
        linhas.push('');
        linhas.push('DURANTE / POS');
        linhas.push(...posLines);
      }
      linhas.push('');
      linhas.push(dto.notes?.trim() ? `💬 ${dto.notes.trim()}` : `💬 Sem comentario escrito.`);

      await this.telegram.notifyCoach(linhas.join('\n')).catch(() => undefined);
    }

    const missedReasons = Array.isArray((details as Record<string, unknown>).missedReasons)
      ? ((details as Record<string, unknown>).missedReasons as unknown[]).filter((value): value is string => typeof value === 'string')
      : [];
    const missedComment = typeof (details as Record<string, unknown>).missedComment === 'string'
      ? ((details as Record<string, unknown>).missedComment as string)
      : '';
    const exerciseFeedbackRaw = (details as Record<string, unknown>).exerciseFeedback;
    const exerciseFeedback = Array.isArray(exerciseFeedbackRaw)
      ? (exerciseFeedbackRaw as unknown[]).filter((item): item is { name: string; loadKg: string; satisfaction: string } =>
          typeof item === 'object' && item !== null && 'name' in item)
      : [];
    const exerciseFeedbackText = exerciseFeedback.length
      ? exerciseFeedback.map((item) => {
          const load = item.loadKg ? `${item.loadKg}kg` : null;
          const feel = item.satisfaction === 'otimo' ? 'otimo' : item.satisfaction === 'ok' ? 'ok' : item.satisfaction === 'dificil' ? 'dificil' : null;
          const parts = [load, feel].filter(Boolean).join(', ');
          return parts ? `${item.name} (${parts})` : item.name;
        }).join('; ')
      : '';

    const statusLabelForProfile = dto.status === 'done' ? 'concluiu' : dto.status === 'adjusted' ? 'fez com ajustes' : 'nao fez';
    const profileParts = [
      `Aluno ${statusLabelForProfile} o treino "${session.title}".`,
      dto.distanceKm ? `Distancia: ${dto.distanceKm}km.` : '',
      dto.avgPaceSecondsKm ? `Pace medio: ${Math.floor(dto.avgPaceSecondsKm / 60)}:${String(dto.avgPaceSecondsKm % 60).padStart(2, '0')}/km.` : '',
      // Bloco Sono (v2). "5" nestas variaveis sempre significa MAIS da coisa perguntada — 5 em
      // irregularidade/interrupcao/dificuldade e' RUIM (mais problema), nao inverter a leitura.
      dto.preSleepQuality ? `Qualidade do sono na noite anterior: ${dto.preSleepQuality}/5 (1=muito ruim, 5=excelente).` : '',
      dto.sleepDurationCategory ? `Duracao do sono: ${sleepDurationCategoryLabel(dto.sleepDurationCategory)}.` : '',
      dto.bedtimeShiftDirection ? `Horario de dormir vs. habitual: ${sleepShiftLabel(dto.bedtimeShiftDirection)}.` : '',
      dto.wakeTimeShiftDirection ? `Horario de acordar vs. habitual: ${sleepShiftLabel(dto.wakeTimeShiftDirection)}.` : '',
      dto.sleepInterruption ? `Sono interrompido durante a noite: ${dto.sleepInterruption}/5 (5=mais interrompido).` : '',
      dto.sleepDifficulty ? `Dificuldade para pegar no sono: ${dto.sleepDifficulty}/5 (5=mais dificuldade).` : '',
      // Bloco Estado antes do treino. preStressLevel a partir da v2 mede as ultimas 24h, nao o
      // instante antes de comecar (mesma coluna, janela temporal diferente — ver schema.prisma).
      dto.prePhysicalFatigue ? `Cansaco fisico antes do treino: ${dto.prePhysicalFatigue}/5 (5=muito alto).` : '',
      dto.preMentalFatigue ? `Cansaco mental antes do treino: ${dto.preMentalFatigue}/5 (5=muito alto).` : '',
      dto.preStressLevel ? `Nivel de estresse${dto.sleepDurationCategory || dto.preMentalFatigue ? ' (ultimas 24h)' : ' antes do treino'}: ${dto.preStressLevel}/5 (5=muito alto).` : '',
      dto.stressEventFrequency ? `Frequencia de momentos de estresse (ultimas 24h): ${dto.stressEventFrequency}/5 (5=quase continuamente).` : '',
      dto.preMotivation ? `Vontade de fazer o treino antes de comecar: ${dto.preMotivation}/5 (5=muito alta).` : '',
      // Bloco Resposta ao treino
      dto.perceivedEffort ? `Esforco percebido (RPE): ${dto.perceivedEffort}/10.` : '',
      dto.satisfactionElaboracao ? `Avaliacao da elaboracao do treino: ${satisfactionLabel(dto.satisfactionElaboracao)}.` : '',
      dto.executionBehavior ? `Execucao em relacao ao prescrito (categoria comportamental, nao escala): ${executionBehaviorLabel(dto.executionBehavior)}.` : '',
      !dto.executionBehavior && dto.executionVsPrescribed ? `Execucao em relacao ao prescrito: ${executionVsPrescribedLabel(dto.executionVsPrescribed)} (3=fez exatamente como prescrito, nao e' escala de qualidade).` : '',
      dto.satisfactionCapacidade && !dto.executionVsPrescribed ? `Satisfacao com como conseguiu executar: ${satisfactionLabel(dto.satisfactionCapacidade)}.` : '',
      dto.postPhysicalFatigue ? `Cansaco fisico provocado por este treino: ${dto.postPhysicalFatigue}/5 (5=extremamente cansado).` : '',
      dto.postMentalFatigue ? `Cansaco mental provocado por este treino: ${dto.postMentalFatigue}/5 (5=extremamente cansado).` : '',
      dto.postWorkoutFeeling && !dto.postPhysicalFatigue ? `Sensacao ao terminar: ${dto.postWorkoutFeeling}/5.` : '',
      dto.emotionalExperienceDuring ? `Experiencia emocional durante o treino: ${dto.emotionalExperienceDuring}/5 (5=muito bem).` : '',
      dto.mentalStateChangePrePost ? `Mudanca no estado mental (comparando antes e depois do treino): ${dto.mentalStateChangePrePost}/5 (5=muito melhor que antes).` : '',
      // Dor
      dto.painFlag && dto.painFlag !== 'none' ? `Dor/desconforto: ${painFlagLabel(dto.painFlag)}.` : '',
      dto.painTiming ? `Timing da dor: ${painTimingLabel(dto.painTiming)}.` : '',
      // Historico (pre-v1)
      dto.satisfaction ? `Satisfacao em fazer o treino: ${satisfactionLabel(dto.satisfaction)}.` : '',
      dto.satisfactionCarga ? `Carga do treino: ${cargaLabel(dto.satisfactionCarga)}.` : '',
      exerciseFeedbackText ? `Feedback por exercicio: ${exerciseFeedbackText}.` : '',
      missedReasons.length ? `Motivo(s) de nao ter treinado: ${missedReasons.map(missedReasonLabel).join(', ')}.` : '',
      // Auditoria Astra (29/09/2026), item 10 — CAUSA RAIZ: missedComment e dto.notes sao texto livre
      // que TAMBEM alimentam reportTimeline.record() logo abaixo (WORKOUT_MISSED_COMMENT/
      // WORKOUT_FEEDBACK_NOTES, analisados pelo Agente Relator). Repeti-los aqui fazia o mesmo relato
      // virar duas evidencias independentes no Prontuario quando o Relator classificava
      // relevance != PONTUAL (uma crua aqui, outra interpretada via Relator). profileParts agora so
      // carrega os campos ESTRUTURADOS (sono/fadiga/RPE/satisfacao/dor/motivos) — nunca produzidos
      // pelo Relator — o texto livre passa a ter uma unica incorporacao narrativa.
    ].filter(Boolean).join(' ');
    void this.studentProfile.recordEvent(userId, ProfileEventCode.WORKOUT_COMPLETED, profileParts).catch(() => undefined);

    const student = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    const coachEmails = (this.config.get<string>('COACH_EMAILS') ?? '')
      .split(',')
      .map((email) => email.trim().toLowerCase())
      .filter(Boolean);
    if (coachEmails.length) {
      const coaches = await this.prisma.user.findMany({ where: { email: { in: coachEmails } }, select: { id: true } });
      const statusLabel = dto.status === 'done' ? 'concluiu' : dto.status === 'adjusted' ? 'registrou com ajustes' : 'marcou como nao feito';
      const details = [
        dto.preSleepQuality ? `Sono: ${dto.preSleepQuality}/5.` : '',
        dto.sleepDifficulty ? `Dificuldade pra dormir: ${dto.sleepDifficulty}/5.` : '',
        dto.prePhysicalFatigue ? `Cansaco fisico pre: ${dto.prePhysicalFatigue}/5.` : '',
        dto.preMentalFatigue ? `Cansaco mental pre: ${dto.preMentalFatigue}/5.` : '',
        dto.preMotivation ? `Vontade de treinar: ${dto.preMotivation}/5.` : '',
        dto.perceivedEffort ? `RPE: ${dto.perceivedEffort}/10.` : '',
        dto.satisfactionElaboracao ? `Elaboracao: ${satisfactionLabel(dto.satisfactionElaboracao)}.` : '',
        dto.executionBehavior ? `Execucao vs. prescrito: ${executionBehaviorLabel(dto.executionBehavior)}.` :
          dto.executionVsPrescribed ? `Execucao vs. prescrito: ${executionVsPrescribedLabel(dto.executionVsPrescribed)}.` :
          dto.satisfactionCapacidade ? `Execucao: ${satisfactionLabel(dto.satisfactionCapacidade)}.` : '',
        dto.postPhysicalFatigue ? `Cansaco fisico provocado: ${dto.postPhysicalFatigue}/5.` : dto.postWorkoutFeeling ? `Sensacao final: ${dto.postWorkoutFeeling}/5.` : '',
        dto.painFlag && dto.painFlag !== 'none' ? `Dor: ${painFlagLabel(dto.painFlag)}${dto.painTiming ? ` (${painTimingLabel(dto.painTiming)})` : ''}.` : '',
        missedReasons.length ? `Motivo(s) da falta: ${missedReasons.map(missedReasonLabel).join(', ')}.` : '',
        missedComment.trim() ? `Comentario do aluno: ${missedComment.trim()}` : '',
        dto.notes?.trim() ? `Feedback: ${dto.notes.trim()}` : 'Sem comentario.',
      ].filter(Boolean).join(' ');
      // 07/09: titulo identifica o treino (aluno + modalidade + data) pra ficar proeminente no
      // painel. Mensagem traz so o feedback — hierarquia mais clara sem misturar tudo numa string.
      const modalityLabel = session.modality === 'corrida' ? 'Corrida' :
        session.modality === 'fortalecimento_corredores' ? 'Fortalecimento' :
        session.modality === 'forca' ? 'Musculacao' : session.title;
      const distanceText = dto.distanceKm ? ` ${dto.distanceKm}km` : '';
      const notifTitle = `${student?.name?.split(' ')[0] ?? 'Aluno'} — ${modalityLabel}${distanceText} ${weekdayAbrev} ${dataFormatada}`;
      await this.prisma.userNotification.createMany({
        data: coaches.map((coach) => ({
          userId: coach.id,
          title: notifTitle,
          message: `${statusLabel.charAt(0).toUpperCase() + statusLabel.slice(1)}. ${details}`,
          type: dto.status === 'missed' ? 'warning' : 'info',
        })),
      });
    }

    // Linha do Tempo de Relatos (28/09/2026) — fire-and-forget, nunca bloqueia o salvamento do
    // feedback nem depende dele ter sucesso pra completar (o feedback ja foi salvo acima).
    const relatedLabel = `${session.title} (${session.modality}) - ${weekdayAbrev} ${dataFormatada}`;
    void this.reportTimeline.record({
      userId,
      sourceType: STUDENT_REPORT_SOURCE_TYPES.WORKOUT_FEEDBACK_NOTES,
      sourceId: completion.id,
      promptQuestion: 'Quer contar mais alguma coisa sobre o treino?',
      relatedLabel,
      originalText: dto.notes,
      occurredAt: session.scheduledDate,
    });
    void this.reportTimeline.record({
      userId,
      sourceType: STUDENT_REPORT_SOURCE_TYPES.WORKOUT_MISSED_COMMENT,
      sourceId: completion.id,
      promptQuestion: 'Conte com suas palavras, se quiser (por que nao treinou)',
      relatedLabel,
      originalText: missedComment,
      occurredAt: session.scheduledDate,
    });
    void this.reportTimeline.record({
      userId,
      sourceType: STUDENT_REPORT_SOURCE_TYPES.WORKOUT_ADJUSTMENT_COMMENT,
      sourceId: completion.id,
      promptQuestion: 'Conte com suas palavras, se quiser (o que foi diferente do prescrito)',
      relatedLabel,
      originalText: dto.adjustmentComment,
      occurredAt: session.scheduledDate,
    });

    // Sistema de Medalhas (30/09/2026) — fire-and-forget, nunca pode bloquear nem falhar o
    // salvamento do feedback (que já aconteceu acima). Avalia tanto as categorias ligadas a esta
    // ação (treinos concluídos/distância/acumulado/feedbacks/retomada) quanto as de fechamento
    // semanal (constância/volume/sustentação) — não existe cron dedicado pra isso, então o
    // registro de um treino é o ponto natural mais frequente pra pegar semanas que já fecharam.
    void this.medalEvaluation?.evaluateForUser(userId, 'workout_completed').catch(() => undefined);
    void this.medalEvaluation?.evaluateForUser(userId, 'week_closed').catch(() => undefined);

    return completion;
  }

  async recordFirstViewed(userId: string, sessionId: string) {
    try {
      const first = await this.prisma.trainingSession.findFirst({
        where: { userId }, orderBy: [{ scheduledDate: 'asc' }, { createdAt: 'asc' }], select: { id: true },
      });
      if (first?.id === sessionId) await this.recordActivationEvent(userId, 'first_workout_viewed', 'first_workout_viewed');
    } catch {
      // Endpoint analitico sempre degrada para sucesso.
    }
    return { ok: true };
  }

  private async maybeRecordFirstCompleted(userId: string, sessionId: string) {
    try {
      const firstRealCompletion = await this.prisma.workoutCompletion.findFirst({
        where: { userId, status: { in: ['done', 'adjusted'] } },
        orderBy: [{ completedAt: 'asc' }],
        select: { sessionId: true },
      });
      if (firstRealCompletion?.sessionId === sessionId) {
        await this.recordActivationEvent(userId, 'first_workout_completed', 'first_workout_completed');
      }
    } catch {
      // Analytics nunca afeta a conclusao principal.
    }
  }

  private async recordActivationEvent(userId: string, event: string, uniqueSuffix: string) {
    try {
      const identity = await this.prisma.funnelEvent.findFirst({ where: { userId }, orderBy: { createdAt: 'desc' }, select: { sessionId: true, journeyId: true } });
      await this.prisma.funnelEvent.create({ data: {
        sessionId: identity?.sessionId ?? `backend:${userId}`.slice(0, 64), journeyId: identity?.journeyId ?? null,
        userId, event, dedupeKey: `${uniqueSuffix}:${userId}`,
      } });
    } catch {
      // Idempotencia ou indisponibilidade de analytics nunca afeta o registro do treino.
    }
  }

  // 01/10/2026 — sono pertence a UMA NOITE (userId+dia do treino), nao a sessao. Upsert por
  // (userId, nightDate): duas (ou tres) sessoes no mesmo dia convergem pro MESMO registro — nunca
  // cria um segundo. So mexe nos campos que vieram no payload (demais ficam como estavam), pra uma
  // sessao que so' confirma dados ja carregados nao apagar nada por engano. Sono nao depende de
  // status da sessao (done/adjusted/missed) — roda sempre que algum campo de sono vier preenchido.
  private async resolveNightlySleepLog(
    userId: string,
    nightDate: Date,
    dto: UpsertWorkoutCompletionDto,
  ): Promise<string | null> {
    const hasSleepData = [
      dto.preSleepQuality,
      dto.sleepDurationCategory,
      dto.bedtimeShiftDirection,
      dto.wakeTimeShiftDirection,
      dto.sleepInterruption,
      dto.sleepDifficulty,
    ].some((value) => value !== undefined);
    if (!hasSleepData) return null;

    const night = await this.prisma.nightlySleepLog.upsert({
      where: { userId_nightDate: { userId, nightDate } },
      create: {
        userId,
        nightDate,
        sleepQuality: dto.preSleepQuality,
        sleepDurationCategory: dto.sleepDurationCategory,
        sleepDurationHoursEstimate: sleepDurationHoursEstimate(dto.sleepDurationCategory),
        bedtimeShiftDirection: dto.bedtimeShiftDirection,
        wakeTimeShiftDirection: dto.wakeTimeShiftDirection,
        sleepInterruption: dto.sleepInterruption,
        sleepDifficulty: dto.sleepDifficulty,
      },
      update: {
        ...(dto.preSleepQuality !== undefined ? { sleepQuality: dto.preSleepQuality } : {}),
        ...(dto.sleepDurationCategory !== undefined
          ? { sleepDurationCategory: dto.sleepDurationCategory, sleepDurationHoursEstimate: sleepDurationHoursEstimate(dto.sleepDurationCategory) }
          : {}),
        ...(dto.bedtimeShiftDirection !== undefined ? { bedtimeShiftDirection: dto.bedtimeShiftDirection } : {}),
        ...(dto.wakeTimeShiftDirection !== undefined ? { wakeTimeShiftDirection: dto.wakeTimeShiftDirection } : {}),
        ...(dto.sleepInterruption !== undefined ? { sleepInterruption: dto.sleepInterruption } : {}),
        ...(dto.sleepDifficulty !== undefined ? { sleepDifficulty: dto.sleepDifficulty } : {}),
      },
    });
    return night.id;
  }

  // 01/10/2026 — estresse tem timestamp REAL (respondedAt) e janela movel de 24h, nunca uma noite.
  // Se o completion que esta sendo editado ja apontava pra um StressCheckin, reutiliza o MESMO
  // (evita que reeditar um feedback antigo acabe atualizando um checkin mais recente de outra
  // sessao por coincidencia de janela). So' caindo nesse caso cria um novo, procura o mais recente
  // dentro de 24h; sem nenhum candidato, cria um novo com respondedAt = agora. Atualizar NUNCA
  // altera respondedAt — preserva a temporalidade real da primeira resposta daquela janela.
  private async resolveStressCheckin(
    userId: string,
    dto: UpsertWorkoutCompletionDto,
    previousStressCheckinId: string | null,
  ): Promise<string | null> {
    const hasStressData = dto.preStressLevel !== undefined || dto.stressEventFrequency !== undefined;
    if (!hasStressData) return previousStressCheckinId;

    let targetId = previousStressCheckinId;
    if (!targetId) {
      const recent = await this.prisma.stressCheckin.findFirst({
        where: { userId, respondedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
        orderBy: { respondedAt: 'desc' },
        select: { id: true },
      });
      targetId = recent?.id ?? null;
    }

    if (targetId) {
      const updated = await this.prisma.stressCheckin.update({
        where: { id: targetId },
        data: {
          ...(dto.preStressLevel !== undefined ? { stressLevel: dto.preStressLevel } : {}),
          ...(dto.stressEventFrequency !== undefined ? { stressEventFrequency: dto.stressEventFrequency } : {}),
        },
      });
      return updated.id;
    }

    const created = await this.prisma.stressCheckin.create({
      data: { userId, stressLevel: dto.preStressLevel, stressEventFrequency: dto.stressEventFrequency },
    });
    return created.id;
  }

  // Autoload (01/10/2026): o mobile consulta isto ANTES de abrir o formulario de uma segunda sessao
  // do mesmo dia, pra pre-preencher o bloco Sono em vez de perguntar de novo. Nunca cria nada.
  async getNightlySleepLog(userId: string, nightDate: Date) {
    return this.prisma.nightlySleepLog.findUnique({ where: { userId_nightDate: { userId, nightDate } } });
  }

  // Autoload (01/10/2026): mesma ideia para estresse — o mobile mostra a resposta recente (se
  // existir dentro de 24h) e deixa o aluno manter ou atualizar, em vez de perguntar sem necessidade.
  async getRecentStressCheckin(userId: string) {
    return this.prisma.stressCheckin.findFirst({
      where: { userId, respondedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
      orderBy: { respondedAt: 'desc' },
    });
  }
}

export function satisfactionLabel(value: string) {
  const labels: Record<string, string> = {
    amei: 'Amei',
    gostei: 'Gostei',
    neutro: 'Neutro',
    nao_gostei: 'Nao gostei',
    detestei: 'Detestei',
  };
  return labels[value] ?? value;
}

export function cargaLabel(value: string) {
  const labels: Record<string, string> = {
    muito_leve: 'Muito leve',
    leve: 'Leve',
    na_medida: 'Na medida',
    pesada: 'Pesada',
    muito_pesada: 'Muito pesada',
  };
  return labels[value] ?? value;
}

// Conversao numerica pra quantificar as respostas (pedido do treinador 19/08) — usada so pra
// exibicao/media no painel do treinador, nunca pra decidir ou validar o proprio treino (isso
// continua 100% a cargo da IA, ver panzeri_methodology). amei..detestei e uma escala normal
// "quanto maior, melhor" (1 a 5). satisfactionCarga NAO e assim: "na medida" e o alvo, entao a
// escala fica em torno de zero — desviar pra qualquer lado (leve OU pesada) e igualmente um sinal
// de ajuste, nunca "pesada e melhor que leve" so por ter numero maior.
export const SATISFACTION_SCORE: Record<string, number> = {
  detestei: 1,
  nao_gostei: 2,
  neutro: 3,
  gostei: 4,
  amei: 5,
};

export const CARGA_SCORE: Record<string, number> = {
  muito_leve: -2,
  leve: -1,
  na_medida: 0,
  pesada: 1,
  muito_pesada: 2,
};

export function painFlagLabel(value: string) {
  const labels: Record<string, string> = {
    none: 'Nenhuma',
    leve: 'Leve',
    moderado: 'Moderado',
    forte: 'Forte',
  };
  return labels[value] ?? value;
}

// Feedback v2 (24/09/2026) — transcricao numerica direta da categoria de duracao do sono (ponto
// medio da faixa escolhida). NAO e' uma formula/indice, e' so' a mesma informacao em outra unidade,
// gravada pra facilitar calculo futuro sem reinterpretar a resposta do aluno.
export function sleepDurationHoursEstimate(category: string | undefined): number | undefined {
  const midpoints: Record<string, number> = {
    menos_5h: 4.5,
    '5_a_6h': 5.5,
    '6_a_7h': 6.5,
    '7_a_8h': 7.5,
    '8_a_9h': 8.5,
    mais_9h: 9.5,
  };
  return category ? midpoints[category] : undefined;
}

// Direcao + magnitude do desvio de horario (dormir/acordar) vs. habitual (01/10/2026).
export function sleepShiftLabel(value: string) {
  const labels: Record<string, string> = {
    much_earlier: 'mais de 1h mais cedo',
    moderately_earlier: '30-60min mais cedo',
    slightly_earlier: 'ate 30min mais cedo',
    on_time: 'proximo do horario habitual',
    slightly_later: 'ate 30min mais tarde',
    moderately_later: '30-60min mais tarde',
    much_later: 'mais de 1h mais tarde',
  };
  return labels[value] ?? value;
}

export function sleepDurationCategoryLabel(value: string) {
  const labels: Record<string, string> = {
    menos_5h: 'Menos de 5 horas',
    '5_a_6h': 'Entre 5 e 6 horas',
    '6_a_7h': 'Entre 6 e 7 horas',
    '7_a_8h': 'Entre 7 e 8 horas',
    '8_a_9h': 'Entre 8 e 9 horas',
    mais_9h: 'Mais de 9 horas',
  };
  return labels[value] ?? value;
}

// executionVsPrescribed: 3 e' o ponto de referencia (fez como prescrito) — a escala representa
// DIRECAO do desvio, nao uma intensidade positiva/negativa. Nunca interpretar 5 como "melhor".
// CONGELADA (01/10/2026) — so' para completions antigos (feedbackVersion 2, sem executionBehavior).
export function executionVsPrescribedLabel(value: number) {
  const labels: Record<number, string> = {
    1: 'Fez bem menos que o prescrito',
    2: 'Fez um pouco menos que o prescrito',
    3: 'Fez como prescrito',
    4: 'Fez um pouco mais que o prescrito',
    5: 'Fez bem mais que o prescrito',
  };
  return labels[value] ?? String(value);
}

// 01/10/2026 — substitui executionVsPrescribedLabel a partir do feedbackVersion 3. Categorias
// comportamentais SEM ordem/intensidade entre si — a ordem abaixo e so' a ordem de exibicao no
// formulario, nunca "1=pior, 5=melhor" nem qualquer outra leitura ordinal.
export function executionBehaviorLabel(value: string) {
  const labels: Record<string, string> = {
    as_planned: 'Seguiu o treino como estava planejado',
    minor_adaptations: 'Fez algumas adaptacoes durante o treino',
    major_changes: 'Mudou bastante o treino durante a execucao',
    different_workout: 'Decidiu fazer um treino diferente',
    stopped_early: 'Interrompeu o treino antes de terminar',
  };
  return labels[value] ?? value;
}

export function painTimingLabel(value: string) {
  const labels: Record<string, string> = {
    ja_comecei_sentindo: 'ja comecei sentindo',
    comeco_passou: 'apareceu no comeco e passou',
    comeco_continuou: 'apareceu no comeco e continuou',
    durante_passou: 'apareceu durante e passou',
    durante_continuou: 'apareceu durante e continuou ate o final',
    so_depois: 'so percebi depois que terminei',
  };
  return labels[value] ?? value;
}

// Labels para motivos de caminhada/parada (multi-select, 14/09/2026 — ver WALKING_SUBOPTIONS em App.tsx)
function walkingReasonLabel(value: string) {
  const labels: Record<string, string> = {
    caminhou_conforme_prescrito: 'caminhou conforme prescrito',
    caminhou_pouco_esforco: 'caminhou pouco (esforco alto)',
    caminhou_muito_esforco: 'caminhou bastante (esforco alto)',
    caminhou_outros: 'caminhou por outros motivos',
    parou_agua: 'parou para beber agua',
    parou_banheiro: 'parou para ir ao banheiro',
    parou_outros: 'parou por outros motivos',
  };
  return labels[value] ?? value;
}

// Mesmas opcoes/valores do seletor de motivo de falta no app (ver MISSED_REASON_OPTIONS em
// App.tsx) — mantido em texto legivel aqui pro prontuario e pro treinador, nao pro aluno.
function missedReasonLabel(value: string) {
  const labels: Record<string, string> = {
    falta_tempo: 'falta de tempo/correria do dia',
    cansaco: 'cansaco/sem energia',
    dor: 'dor ou desconforto fisico',
    doente: 'doente',
    viagem: 'viagem',
    imprevisto_pessoal: 'imprevisto pessoal ou familiar',
    trabalho: 'compromisso de trabalho',
    clima: 'clima',
    falta_motivacao: 'falta de motivacao',
    esqueci: 'esqueceu/perdeu o horario',
  };
  return labels[value] ?? value;
}
