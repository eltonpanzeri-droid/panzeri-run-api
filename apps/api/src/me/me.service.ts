import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isRoutineAnswerKey } from '../training-plans/training-methodology';
import { readRoutineState } from '../common/routine-state';
import { UpdateAnamneseDto } from './dto/update-anamnese.dto';
import { UpdateHealthDto } from './dto/update-health.dto';
import { UpdatePreferencesDto } from './dto/update-preferences.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { normalizeCpf } from '../billing/billing.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { TrainingPlansService, hasSubscriptionAccess } from '../training-plans/training-plans.service';
import { StudentProfileService, ProfileEventCode } from '../training-plans/student-profile.service';
import { ONBOARDING_INTERVIEW_VERSION } from '../reassessment/reassessment-trajectory';
import { ULTRA_DISTANCE_KEY, composeObjective, isUltraObjective, parseUltraKm } from './objective';
import { ReportTimelineService } from '../reporter/report-timeline.service';
import { STUDENT_REPORT_SOURCE_TYPES } from '../reporter/report-timeline.constants';

// (10/2026) Regra vigente: salvar a rotina NUNCA regenera, arquiva ou altera treinos ja entregues; a rotina vale na PROXIMA geracao (a geracao da semana seguinte
// e' liberada aos domingos a partir das 12h, America/Sao_Paulo, e e' sob demanda — nao ha geracao automatica). Os comentarios abaixo sobre "domingo automatico" sao historicos.
// ATE 03/08 existia um limite de 1 alteracao de rotina a cada 30 dias, porque cada mudanca
// disparava uma geracao de IA na hora (custo real por alteracao). Ordem explicita do treinador
// (03/08): uma mudanca de rotina de quem JA TEM plano ativo nunca mais gera na hora — ela so
// entra em vigor na proxima geracao automatica de domingo (generateFirstWeekIfNeeded age como
// gate: so gera de verdade se for a primeira vez). Sem chamada de IA por mudanca, nao ha mais
// custo a proteger, entao o limite de frequencia deixou de fazer sentido e foi removido — o
// aluno pode ajustar a rotina quantas vezes quiser durante a semana, vale sempre a ULTIMA versao
// salva antes de domingo.

@Injectable()
export class MeService {
  private readonly logger = new Logger(MeService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
    private readonly studentProfile: StudentProfileService,
    private readonly telegram: TelegramService,
    private readonly reportTimeline: ReportTimelineService,
  ) {}

  acceptExerciseResponsibility(userId: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { acceptedExerciseResponsibilityAt: new Date() },
      select: { acceptedExerciseResponsibilityAt: true },
    });
  }

  // Lista simples dos dias (contrato antigo, lida por clientes existentes). O estado com revisao e' GET /me/routine.
  availability(userId: string) {
    return this.prisma.weeklyAvailability.findMany({
      where: { userId },
      orderBy: { weekday: 'asc' },
    });
  }

  async onboarding(userId: string) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    if (interview?.completedAt && Object.keys(asAnswerObject(interview.answers)).length === 0) {
      return this.prisma.onboardingInterview.update({
        where: { userId },
        data: { completedAt: null, currentStep: 0 },
      });
    }
    return interview ?? { userId, answers: {}, currentStep: 0, completedAt: null };
  }

  reopenOnboarding(userId: string) {
    return this.prisma.onboardingInterview.upsert({
      where: { userId },
      create: { userId, answers: {}, currentStep: 0 },
      update: { completedAt: null, currentStep: 0 },
    });
  }

  async saveOnboardingAnswer(userId: string, dto: { key: string; value: unknown; currentStep: number }) {
    if (!/^[a-z0-9_]+$/i.test(dto.key) || dto.currentStep < 0) {
      throw new BadRequestException('Resposta de entrevista invalida.');
    }
    // (26/10/2026) Entrevista e rotina sao processos independentes: respostas de rotina nao sao mais gravadas na entrevista (a rotina so' muda por PUT /me/availability).
    if (isRoutineAnswerKey(dto.key)) {
      throw new BadRequestException({ code: 'routine_not_interview', message: 'A rotina de treinos nao faz mais parte da entrevista. Atualize o aplicativo e use "Rotina de treinos".' });
    }
    const current = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    const answers = asAnswerObject(current?.answers);
    if (dto.key === ULTRA_DISTANCE_KEY && parseUltraKm(dto.value) === null) throw new BadRequestException({ code: 'invalid_ultra_distance', message: 'Informe a distancia da ultramaratona em quilometros (de 43 a 999).' });
    answers[dto.key] = JSON.parse(JSON.stringify(dto.value)) as Prisma.InputJsonValue;
    const result = await this.prisma.onboardingInterview.upsert({
      where: { userId },
      create: { userId, answers, currentStep: dto.currentStep },
      update: { answers, currentStep: dto.currentStep },
    });

    // Correcao de divergencia (Melhorias pos-Bloco 3, 04/10/2026): esta funcao e' o unico caminho
    // de correcao POS-onboarding pra telefone/CPF/escolaridade/endereco (modulo "Dados pessoais" do
    // fixModule, acionado por "Conta" -> "Editar dados") — antes so' gravava neste JSON, nunca em
    // User, que e' quem cobranca/Telegram/painel do treinador realmente leem. Resultado: a aluna
    // via o dado "corrigido" na entrevista, mas o resto do sistema continuava com o valor antigo.
    // Sincroniza so' o campo que acabou de ser editado (nunca recalcula os outros a partir do JSON
    // inteiro, pra nao sobrescrever um campo correto com um valor antigo/ausente da entrevista).
    // Nome/nascimento/sexo/altura/peso NAO entram aqui de proposito — esses tem fonte propria
    // (PUT /me/profile via "Conta", PUT /me/anamnese via "Perfil"); sincronizar aqui tambem criaria
    // uma terceira fonte de verdade pra eles.
    await this.syncIdentityAnswerToUser(userId, dto.key, answers);

    // (10/2026) Correcao explicita do objetivo (tela "Corrigir respostas"/entrevista): atualiza o objetivo OPERACIONAL (UserPreferences.mainGoal), que e' o que o
    // Prescritor recebe. A resposta anterior fica preservada em OnboardingInterview.answers so' ate' ser sobrescrita pela nova; o historico de mudancas de objetivo
    // vem das reavaliacoes. Antes da primeira conclusao nao ha preferencias: o objetivo e' projetado em completeOnboarding.
    // Mesma ideia para as demais preferencias operacionais que a entrevista inicial projeta (experiencia, atividades atuais/preferidas): so' o campo editado, so' se
    // as preferencias ja existem (depois da primeira conclusao) — nunca recalcula os outros a partir do JSON inteiro.
    const preferencesPatch: Prisma.UserPreferencesUpdateInput | null =
      dto.key === 'objective' && typeof dto.value === 'string' && dto.value.trim() ? { mainGoal: composeObjective(dto.value, answers[ULTRA_DISTANCE_KEY]) ?? dto.value.trim() }
        : dto.key === ULTRA_DISTANCE_KEY && isUltraObjective(answers.objective) ? { mainGoal: composeObjective(answers.objective, dto.value) ?? String(answers.objective) }
        : dto.key === 'running_experience' && typeof dto.value === 'string' && dto.value.trim() ? { experienceLevel: dto.value.trim() }
          : dto.key === 'current_activities' && Array.isArray(dto.value) ? { preferredModalities: stringArray(dto.value) }
            : dto.key === 'favorite_activities' && Array.isArray(dto.value) ? { otherModalities: stringArray(dto.value) }
              : null;
    if (preferencesPatch) {
      const preferences = await this.prisma.userPreferences.findUnique({ where: { userId }, select: { userId: true } });
      if (preferences) await this.prisma.userPreferences.update({ where: { userId }, data: preferencesPatch });
    }

    // Saude: correcao explicita de uma resposta atualiza so' o campo derivado correspondente (so' se o perfil de saude ja existe; na 1a conclusao e' criado inteiro).
    const healthPatch = this.healthPatchForAnswer(dto.key, answers);
    if (healthPatch) {
      const profile = await this.prisma.healthProfile.findUnique({ where: { userId }, select: { userId: true } });
      if (profile) await this.prisma.healthProfile.update({ where: { userId }, data: healthPatch });
    }

    // Texto livre "informacao adicional" editado DEPOIS da conclusao da entrevista: segue ao Relator/Prontuario (sem duplicar o mesmo texto). Antes da conclusao,
    // completeOnboarding o encaminha uma vez.
    if (dto.key === 'additional_info' && current?.completedAt && typeof dto.value === 'string' && dto.value.trim()) {
      await this.reportTimeline.record({
        userId,
        sourceType: STUDENT_REPORT_SOURCE_TYPES.ONBOARDING_INTERVIEW_ADDITIONAL_INFO,
        promptQuestion: 'Quer acrescentar alguma informacao?',
        relatedLabel: 'Entrevista - informacao adicional (editada)',
        originalText: dto.value,
        occurredAt: new Date(),
        dedupe: true,
      });
    }

    return result;
  }

  // Campo(s) de HealthProfile derivado(s) da resposta editada (os resumos compostos sao recalculados so' quando uma de suas chaves muda).
  private healthPatchForAnswer(key: string, answers: Record<string, Prisma.InputJsonValue>): Prisma.HealthProfileUpdateInput | null {
    if (key === 'sleep_hours') return { averageSleep: stringValue(answers.sleep_hours) };
    if (key === 'rating_stress') return { stressLevel: ratingValue(answers.rating_stress) };
    if (key === 'rating_anxiety') return { anxietyLevel: ratingValue(answers.rating_anxiety) };
    if (key === 'continuous_medications') return { medications: stringValue(answers.continuous_medications) };
    if (key === 'health_conditions' || key === 'health_conditions_other' || key.startsWith('health_condition_status_')) return { healthProblems: healthConditionsSummary(answers) };
    const injuryKeys = ['current_pain', 'important_injury', 'injury_time_since', 'injury_description', 'medical_recommendation', 'diagnosed_running_conditions', 'diagnosed_running_conditions_other'];
    if (injuryKeys.includes(key) || key.startsWith('pain_') || key.startsWith('running_condition_status_')) return { previousInjuries: interviewInjurySummary(answers) };
    return null;
  }

  private async syncIdentityAnswerToUser(userId: string, key: string, answers: Record<string, Prisma.InputJsonValue>) {
    if (key === 'personal_phone') {
      const phone = stringValue(answers.personal_phone);
      if (phone) await this.prisma.user.update({ where: { id: userId }, data: { phone } });
      return;
    }
    if (key === 'personal_education') {
      // Mesma convencao de completeOnboarding: resposta ausente/null vira null em User, nunca ''.
      const education = answers.personal_education != null ? String(answers.personal_education) : null;
      await this.prisma.user.update({ where: { id: userId }, data: { education } });
      return;
    }
    if (key === 'personal_cpf') {
      const normalizedCpf = normalizeCpf(String(answers.personal_cpf ?? ''));
      if (!normalizedCpf) return;
      try {
        await this.prisma.user.update({ where: { id: userId }, data: { cpf: normalizedCpf } });
      } catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new BadRequestException('Este CPF ja esta cadastrado em outra conta. Revise o campo de CPF na entrevista.');
        }
        throw error;
      }
      return;
    }
    if (ADDRESS_ANSWER_KEYS.has(key)) {
      const address = interviewAddressSummary(answers);
      if (address) await this.prisma.user.update({ where: { id: userId }, data: { address } });
    }
  }

  // 18/08: Bloco 2 da reformulacao de onboarding — as "5 perguntas rapidas" que agora rodam ANTES
  // do pagamento (ver [[project_prontuario_doc]] Diario). Mesma tabela/JSON de respostas da
  // entrevista completa (currentStep/answers ja salvos incrementalmente por saveOnboardingAnswer),
  // so um marco a mais: quickIntakeCompletedAt. A entrevista completa/detalhada (completeOnboarding
  // abaixo) continua exatamente como estava, so que agora roda DEPOIS do pagamento — e pula as
  // perguntas ja respondidas aqui (ex: 'objective') porque usam a MESMA chave no mesmo JSON.
  async completeQuickIntake(userId: string) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    const answers = asAnswerObject(interview?.answers);
    const required = ['objective', 'quick_current_stage', 'quick_has_target_race', 'quick_main_barrier', 'quick_expectations'];
    const missing = required.filter((key) => {
      const value = answers[key];
      if (Array.isArray(value)) return value.length === 0;
      return value === undefined || value === '';
    });
    if (missing.length) throw new BadRequestException('Responda todas as perguntas antes de continuar.');

    const result = await this.prisma.onboardingInterview.update({
      where: { userId },
      data: { quickIntakeCompletedAt: new Date() },
    });

    // 10/09: aviso ao treinador — aluno completou as 5 perguntas iniciais.
    // Proximo passo esperado: ir para a tela de pagamento.
    const student = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, studentCode: true, email: true },
    });
    void this.telegram.notifyCoach(
      `✅ Aluno respondeu as 5 perguntas iniciais no Panzeri Run\n\nAluno: ${student?.name ?? student?.email ?? 'desconhecido'} (Cod. ${formatStudentCode(student?.studentCode)})\n\nPróximo passo: pagamento da assinatura.`,
    ).catch(() => undefined);

    return result;
  }

  async completeOnboarding(userId: string) {
    const interview = await this.prisma.onboardingInterview.findUnique({ where: { userId } });
    const answers = asAnswerObject(interview?.answers);
    // 04/09: personal_cep saiu da lista fixa de obrigatorios — desde que o app ganhou entrada
    // manual de endereco (pra quem o ViaCEP nao encontra), quem usa esse caminho nunca preenche um
    // CEP de verdade, so cidade/estado. Exigir o CEP aqui rejeitava no ultimo passo ("Conclua todas
    // as perguntas obrigatorias", sem dizer qual) alguem que a UI ja tinha deixado terminar —
    // pior que o bug original. Agora aceita CEP OU cidade+estado preenchidos a mao.
    // 04/09 (correcao da correcao — caso real: Silvia continuou travada): personal_address_number
    // tambem saiu da lista. Essa pergunta so aparece na tela quando o CEP resolve uma cidade
    // (condition: Boolean(a.personal_address_city)) — se isso nunca acontecer (ou a pessoa passar
    // batido por qualquer motivo), o campo fica permanentemente sem resposta possivel, mas
    // continuava bloqueando aqui do mesmo jeito que o CEP bloqueava antes. Numero da casa nao e
    // usado pra nada essencial (nao gera treino, nao e' cobranca) — vira sempre opcional.
    // 06/09: campos verdadeiramente obrigatorios reducidos a CPF, telefone e nome —
    // os demais aceitam null (aluno escolheu "Prefiro nao responder" na entrevista).
    // CPF e telefone continuam obrigatorios por razoes operacionais (cobranca e contato).
    // Nome e' obrigatorio para identificacao basica na plataforma e nos avisos do treinador.
    const required = ['personal_name', 'personal_phone', 'personal_cpf'];
    const missing = required.filter((key) => answers[key] === undefined || answers[key] === '' || answers[key] === null);
    const hasCep = answers.personal_cep !== undefined && answers.personal_cep !== '';
    const hasManualAddress = Boolean(String(answers.personal_address_city ?? '').trim()) && Boolean(String(answers.personal_address_state ?? '').trim());
    if (!hasCep && !hasManualAddress) missing.push('endereco (CEP ou cidade/estado)');
    // 04/09: achado real (caso Silvia) — a mensagem generica "Conclua todas as perguntas
    // obrigatorias" nao dizia QUAL campo faltava, entao cada vez que alguem travava aqui a gente
    // tinha que adivinhar (ja erramos 2x seguidas por isso: CEP, depois numero da casa). Agora a
    // mensagem lista exatamente as chaves que faltam — quem travar pode nos mandar a mensagem
    // exata em vez de so' "nao consigo concluir", encurtando o diagnostico de horas pra segundos.
    if (missing.length) throw new BadRequestException(`Faltam respostas obrigatorias: ${missing.join(', ')}.`);

    const normalizedCpf = normalizeCpf(String(answers.personal_cpf));
    if (!normalizedCpf) throw new BadRequestException('CPF invalido. Revise o campo de CPF na entrevista.');

    const assessedWeight = decimalValue(answers.personal_weight);
    const bodyFat = decimalValue(answers.body_fat_percentage);
    if (assessedWeight !== null && bodyFat !== null) {
      answers.fat_mass = roundedMeasurement(assessedWeight * bodyFat / 100);
      answers.lean_mass = roundedMeasurement(assessedWeight - assessedWeight * bodyFat / 100);
    }

    if (answers.basal_metabolism === 'automatic' || answers.basal_metabolism === undefined) {
      const basal = harrisBenedict({
        sex: stringValue(answers.personal_sex),
        birthDate: parseInterviewDate(stringValue(answers.personal_birth_date)),
        heightCm: decimalValue(answers.personal_height),
        weightKg: decimalValue(answers.personal_weight),
      });
      answers.basal_metabolism = basal ?? 'Nao foi possivel calcular';
    } else {
      const informedBasal = decimalValue(answers.basal_metabolism);
      if (informedBasal !== null) answers.basal_metabolism = informedBasal;
    }

    const preferredModalities = stringArray(answers.current_activities);
    const completedAt = new Date();
    // Ja' concluida antes? (completedAt some quando a entrevista e' reaberta; interviewVersion permanece.)
    const completedBefore = Boolean(interview?.completedAt) || interview?.interviewVersion != null;

    try {
      await this.prisma.$transaction(async (tx) => {
        // (10/2026) Reconclusao NAO reescreve os dados operacionais do aluno com as respostas antigas (peso, altura, nome, nascimento, sexo...): eles podem ter sido
        // atualizados depois (Perfil/Conta). Telefone, CPF, escolaridade e endereco tem correcao explicita propria (saveOnboardingAnswer). Na 1a conclusao, projeta tudo.
        if (!completedBefore) await tx.user.update({
          where: { id: userId },
          data: {
            name: String(answers.personal_name),
            phone: String(answers.personal_phone),
            // 06/09: campos opcionais agora aceitam null (aluno pode pular na entrevista).
            // String(null) = 'null' — usando operador de coalescencia pra nao gravar 'null' no banco.
            birthDate: answers.personal_birth_date != null ? parseInterviewDate(String(answers.personal_birth_date)) : null,
            sex: answers.personal_sex != null ? String(answers.personal_sex) : null,
            heightCm: decimalValue(answers.personal_height),
            weightKg: decimalValue(answers.personal_weight),
            cpf: normalizedCpf,
            education: answers.personal_education != null ? String(answers.personal_education) : null,
            address: interviewAddressSummary(answers),
          },
        });
        await tx.healthProfile.upsert({
          where: { userId },
          create: {
            userId,
            averageSleep: stringValue(answers.sleep_hours),
            stressLevel: ratingValue(answers.rating_stress),
            anxietyLevel: ratingValue(answers.rating_anxiety),
            previousInjuries: interviewInjurySummary(answers),
            healthProblems: healthConditionsSummary(answers),
            medications: stringValue(answers.continuous_medications),
          },
          // Saude: mesma regra — a reconclusao nao sobrescreve o que o aluno atualizou depois (Perfil/Anamnese); correcao explicita de uma resposta atualiza so' o campo
          // correspondente (saveOnboardingAnswer). As respostas iniciais seguem intactas em OnboardingInterview.answers.
          update: completedBefore ? {} : {
            averageSleep: stringValue(answers.sleep_hours),
            stressLevel: ratingValue(answers.rating_stress),
            anxietyLevel: ratingValue(answers.rating_anxiety),
            previousInjuries: interviewInjurySummary(answers),
            healthProblems: healthConditionsSummary(answers),
            medications: stringValue(answers.continuous_medications),
          },
        });
        await tx.userPreferences.upsert({
          where: { userId },
          create: {
            userId,
            preferredModalities,
            otherModalities: stringArray(answers.favorite_activities),
            trainingLocations: ['Corrida na rua'],
            mainGoal: composeObjective(answers.objective, answers[ULTRA_DISTANCE_KEY]) ?? 'Nao informado',
            experienceLevel: answers.running_experience != null ? String(answers.running_experience) : null,
          },
          // (10/2026) Reconclusao da entrevista NAO reescreve as preferencias operacionais (objetivo, experiencia, modalidades, locais): elas podem ter sido
          // atualizadas depois (reavaliacao, Perfil, correcao da entrevista). A resposta inicial continua preservada em OnboardingInterview.answers (historico) e uma
          // edicao explicita de uma resposta atualiza so' o campo correspondente (saveOnboardingAnswer). Na PRIMEIRA conclusao, as preferencias sao projetadas normalmente.
          update: completedBefore ? {} : {
            preferredModalities,
            otherModalities: stringArray(answers.favorite_activities),
            trainingLocations: ['Corrida na rua'],
            mainGoal: composeObjective(answers.objective, answers[ULTRA_DISTANCE_KEY]) ?? 'Nao informado',
            experienceLevel: answers.running_experience != null ? String(answers.running_experience) : null,
          },
        });
        // Ciclo menstrual: salva perfil menstrual se a aluna informou na entrevista (11/09).
        // Apenas cria/atualiza — nunca apaga dados de ciclos ja registrados (logs).
        // A pergunta so aparece para sex=Feminino; os demais nao chegam a ter essas chaves.
        if (answers.personal_sex === 'Feminino' && answers.menstrual_has_active_cycle !== undefined) {
          const hasActiveCycle = answers.menstrual_has_active_cycle === 'Sim';
          const usesContraceptive = answers.menstrual_uses_contraceptive === 'Sim';
          const menstrualData = {
            hasActiveCycle,
            usesHormonalContraceptive: hasActiveCycle ? usesContraceptive : null,
            contraceptiveType: usesContraceptive && answers.menstrual_contraceptive_type != null
              ? String(answers.menstrual_contraceptive_type)
              : null,
            cycleLengthDays: hasActiveCycle && !usesContraceptive && answers.menstrual_cycle_length != null
              ? Number(answers.menstrual_cycle_length)
              : null,
            periodLengthDays: hasActiveCycle && !usesContraceptive && answers.menstrual_period_length != null
              ? Number(answers.menstrual_period_length)
              : null,
          };
          await tx.menstrualProfile.upsert({
            where: { userId },
            create: { userId, ...menstrualData },
            update: menstrualData,
          });
        }
        // 08/09 (bug real — caso Thais, rotina sumindo com plano de treino ja gerado): ESTE metodo
        // fecha a entrevista PRINCIPAL, que deliberadamente NAO inclui o modulo "Rotina semanal"
        // (ver mainInterviewQuestions/routineQuestions no App.tsx). Antes desta correcao, aqui
        // mesmo apagavamos e recriavamos WeeklyAvailability inteira a partir de
        // buildInterviewAvailability(answers) — mas nesse momento a aluna via de regra AINDA NAO
        // respondeu a rotina (isso so acontece na tela seguinte, "Rotina de treinos", que chama
        // completeRoutineFromInterview e grava a rotina de verdade). Resultado: terminar a
        // entrevista principal podia apagar silenciosamente uma rotina real ja configurada (ex.:
        // aluna refazendo a entrevista principal numa reavaliacao) e substituir por uma vazia,
        // antes mesmo dela chegar na tela de rotina. Quem e' de fato responsavel por
        // WeeklyAvailability e' a tela de Rotina (completeRoutineFromInterview) e as telas de
        // edicao direta (updateAvailability, painel do treinador) — completeOnboarding agora nao
        // mexe mais nisso. Ver PRONTUARIO.md 08/09 para o diagnostico completo.
        await tx.onboardingInterview.update({ where: { userId }, data: { answers, completedAt, interviewVersion: ONBOARDING_INTERVIEW_VERSION } });
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new BadRequestException('Este CPF ja esta cadastrado em outra conta. Revise o campo de CPF na entrevista.');
      }
      throw error;
    }

    void this.studentProfile.recordEvent(
      userId,
      ProfileEventCode.ONBOARDING_COMPLETED,
      `Entrevista inicial concluida. Objetivo: ${stringValue(answers.objective)}. Experiencia com corrida: ${stringValue(answers.running_experience)}. Modalidades praticadas: ${preferredModalities.join(', ') || 'nenhuma informada'}.`,
    ).catch((error) => {
      this.logger.warn(`recordEvent(ONBOARDING_COMPLETED) falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
    });

    // 10/09: aviso ao treinador — aluno concluiu a entrevista completa.
    // Nome ja esta disponivel nas respostas (personal_name); busca no banco so pra ter studentCode.
    const studentForTelegram = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, studentCode: true },
    });
    void this.telegram.notifyCoach(
      `✅ Aluno concluiu a entrevista inicial no Panzeri Run\n\nAluno: ${studentForTelegram?.name ?? stringValue(answers.personal_name) ?? 'desconhecido'} (Cod. ${formatStudentCode(studentForTelegram?.studentCode)})\nObjetivo: ${stringValue(answers.objective)}\nExperiência com corrida: ${stringValue(answers.running_experience)}`,
    ).catch(() => undefined);

    // Linha do Tempo de Relatos (28/09/2026) — texto livre REAL dentro da entrevista (nunca os
    // resumos compostos gravados em HealthProfile, que ja misturam varias respostas numa frase
    // so e deixariam de ser o "texto original" do aluno).
    const healthFreeTextFields: Array<{ key: string; promptQuestion: string }> = [
      { key: 'injury_description', promptQuestion: 'Descreva a lesao/cirurgia/limitacao' },
      { key: 'health_conditions_other', promptQuestion: 'Outra condicao de saude (descreva)' },
      { key: 'medical_recommendation', promptQuestion: 'Alguma recomendacao medica a considerar?' },
      { key: 'continuous_medications', promptQuestion: 'Usa alguma medicacao continua?' },
      // Auditoria Astra (29/09/2026), item 14 — mesmo miss real da reavaliacao (ver
      // reassessment.service.ts): campo de texto livre da entrevista inicial (apps/mobile/App.tsx)
      // que ficou de fora quando a Linha do Tempo de Relatos foi montada (28/09/2026). Ja era lido
      // em outro lugar deste arquivo (painSummary, pra compor HealthProfile) mas nunca alimentava
      // o Relator/Prontuario com o texto ORIGINAL do aluno.
      { key: 'pain_other_location', promptQuestion: 'Sente dor em algum outro local que nao esta na lista acima?' },
    ];
    for (const field of healthFreeTextFields) {
      const text = stringValue(answers[field.key]).trim();
      if (!text) continue;
      void this.reportTimeline.record({
        userId,
        sourceType: STUDENT_REPORT_SOURCE_TYPES.ONBOARDING_INTERVIEW_HEALTH,
        promptQuestion: field.promptQuestion,
        relatedLabel: 'Entrevista inicial - saude',
        originalText: text,
        occurredAt: completedAt,
      });
    }

    // (10/2026) "Informacao adicional": texto livre que o aluno escreveu no fim da entrevista. Antes ficava so' no JSON; agora segue ao Relator/Prontuario
    // (mesmo mecanismo dos demais textos livres), sem registrar de novo o mesmo texto se a entrevista for reconcluida.
    const additionalInfo = stringValue(answers.additional_info).trim();
    if (additionalInfo) {
      void this.reportTimeline.record({
        userId,
        sourceType: STUDENT_REPORT_SOURCE_TYPES.ONBOARDING_INTERVIEW_ADDITIONAL_INFO,
        promptQuestion: 'Quer acrescentar alguma informacao?',
        relatedLabel: 'Entrevista inicial - informacao adicional',
        originalText: additionalInfo,
        occurredAt: completedAt,
        dedupe: true,
      });
    }

    // Incidente real: prospectos respondiam a entrevista inteira, a IA gerava a semana de treino
    // (chamada cara), e boa parte desistia antes de assinar de verdade — gastando tokens a toa.
    // A partir de agora, concluir a entrevista NAO gera mais o treino sozinho: isso so acontece
    // quando o pagamento e confirmado (ver BillingService.triggerFirstWeekGeneration/
    // generateFirstWeekIfNeeded em training-plans.service.ts). A UNICA excecao e um aluno que JA
    // e assinante confirmado e esta reabrindo/refazendo a entrevista (ex: corrigindo algo) — nesse
    // caso gera na hora como sempre, porque ele ja pagou e o gatilho de pagamento nao vai disparar
    // de novo (subscriptionStatus ja estava active antes desta chamada).
    const [payingUser, routine] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionStatus: true } }),
      readRoutineState(this.prisma, userId),
    ]);
    if (payingUser && hasSubscriptionAccess(payingUser.subscriptionStatus)) {
      if (routine.activeDays.length > 0) {
        // Aluno que ja' tem rotina cadastrada (refazendo a entrevista): gera a primeira semana se ainda nao existir programa. Nunca arquiva nem regenera treinos ja' entregues.
        void this.trainingPlans.generateFirstWeekIfNeeded(userId).catch((error) => {
          this.logger.warn(`generateFirstWeekIfNeeded apos completeOnboarding falhou para ${userId} (nao bloqueante): ${(error as Error).message}`);
        });
      } else {
        // Sem rotina cadastrada: o aplicativo leva o aluno ao formulario proprio da rotina. A primeira prescricao so' acontece depois dela (entrevista + rotina + acesso).
        this.logger.log(`Entrevista concluida para ${userId} — rotina ${routine.configured ? 'cadastrada sem dias de treino' : 'ainda nao cadastrada'}; aguardando a rotina para a primeira prescricao.`);
      }
    } else {
      this.logger.log(`Entrevista concluida para ${userId} — geracao da primeira semana adiada ate a confirmacao do pagamento.`);
    }

    return { completed: true, completedAt, next: 'three_km_test', routineConfigured: routine.configured };
  }

  // 10/09: chamado pelo app quando o aluno conclui a correcao de respostas via fixModule
  // (modulo "Corrigir respostas anteriores"). Apenas notifica o treinador — o salvamento
  // das respostas ja foi feito incrementalmente por saveOnboardingAnswer durante a sessao.
  async notifyFixAnswers(userId: string) {
    const student = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, studentCode: true },
    });
    void this.telegram.notifyCoach(
      `🔄 Aluno corrigiu respostas da entrevista no Panzeri Run\n\nAluno: ${student?.name ?? 'desconhecido'} (Cod. ${formatStudentCode(student?.studentCode)})\n\nAs respostas foram atualizadas. Verifique o perfil e avalie se o programa de treinos precisa ser regenerado.`,
    ).catch(() => undefined);
    return { notified: true };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto) {
    const currentSex = (await this.prisma.user.findUnique({ where: { id: userId }, select: { sex: true } }))?.sex ?? null;
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        name: dto.name,
        email: dto.email.toLowerCase(),
        birthDate: dto.birthDate,
        sex: resolveSexToSave(dto.sex, currentSex),
        heightCm: dto.heightCm,
        weightKg: dto.weightKg,
        address: dto.address,
      },
    });
  }

  async updateHealth(userId: string, dto: UpdateHealthDto) {
    const result = await this.prisma.healthProfile.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
    const now = new Date();
    const freeTextFields: Array<{ value: string | null | undefined; promptQuestion: string }> = [
      { value: dto.previousSurgeries, promptQuestion: 'Cirurgias anteriores' },
      { value: dto.previousInjuries, promptQuestion: 'Lesoes, cirurgias ou limitacoes' },
      { value: dto.healthProblems, promptQuestion: 'Problemas de saude' },
      { value: dto.medications, promptQuestion: 'Medicamentos de uso continuo' },
    ];
    for (const field of freeTextFields) {
      void this.reportTimeline.record({
        userId,
        sourceType: STUDENT_REPORT_SOURCE_TYPES.ONBOARDING_INTERVIEW_HEALTH,
        promptQuestion: field.promptQuestion,
        relatedLabel: 'Edicao de dados de saude',
        originalText: field.value,
        occurredAt: now,
      });
    }
    return result;
  }

  updatePreferences(userId: string, dto: UpdatePreferencesDto) {
    return this.prisma.userPreferences.upsert({
      where: { userId },
      create: { userId, ...dto },
      update: dto,
    });
  }

  // A rotina NAO e' gravada aqui: PUT /me/availability (RoutineService) e' o unico caminho do aluno; PUT /me/anamnese so' trata perfil, saude e preferencias.

  async updateAnamnese(userId: string, dto: UpdateAnamneseDto) {
    // (26/10/2026) A anamnese NUNCA grava a rotina: se um cliente antigo ainda enviar `availability`, o campo e' ignorado (a rotina so' muda por PUT /me/availability).
    if (dto.availability?.availability) this.logger.warn(`PUT /me/anamnese recebeu disponibilidade de ${userId}: ignorada (a rotina so' muda por PUT /me/availability).`);

    const normalizedEmail = dto.profile.email.trim().toLowerCase();
    const emailOwner = await this.prisma.user.findUnique({
      where: { email: normalizedEmail },
      select: { id: true },
    });
    if (emailOwner && emailOwner.id !== userId) {
      throw new BadRequestException('Este e-mail ja pertence a outra conta.');
    }

    // (24/10) Versoes antigas do app mandavam sex='prefiro_nao_informar' fixo neste endpoint, apagando "Feminino" e escondendo o ciclo menstrual. Este endpoint nao edita sexo:
    // o placeholder nunca sobrescreve um valor ja' informado (a edicao de verdade e' PUT /me/profile).
    const currentSex = (await this.prisma.user.findUnique({ where: { id: userId }, select: { sex: true } }))?.sex ?? null;
    const sexToSave = resolveSexToSave(dto.profile.sex, currentSex);

    const result = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id: userId },
        data: {
          name: dto.profile.name.trim(),
          email: normalizedEmail,
          birthDate: dto.profile.birthDate,
          sex: sexToSave,
          heightCm: dto.profile.heightCm,
          weightKg: dto.profile.weightKg,
          address: dto.profile.address,
        },
      });

      await tx.healthProfile.upsert({
        where: { userId },
        create: { userId, ...dto.health },
        update: dto.health,
      });

      await tx.userPreferences.upsert({
        where: { userId },
        create: { userId, ...dto.preferences },
        update: dto.preferences,
      });

      return tx.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          role: true,
          accountStatus: true,
          studentCode: true,
          birthDate: true,
          sex: true,
          heightCm: true,
          weightKg: true,
          address: true,
          healthProfile: true,
          preferences: true,
          availability: { orderBy: { weekday: 'asc' } },
          tests: {
            where: { testType: '3km' },
            orderBy: { createdAt: 'desc' },
            take: 1,
          },
        },
      });
    });

    return { ...result, routineChanged: false };
  }
}

export function asAnswerObject(value: unknown): Record<string, Prisma.InputJsonValue> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return JSON.parse(JSON.stringify(value)) as Record<string, Prisma.InputJsonValue>;
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.map(String) : [];
}

function stringValue(value: unknown) {
  return value === undefined || value === null ? '' : String(value);
}

function ratingValue(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) ? `${number}/10` : 'Nao informado';
}

function parseInterviewDate(value: string) {
  const br = value.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (br) {
    const day = Number(br[1]);
    const month = Number(br[2]);
    const year = Number(br[3]);
    const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
    if (date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day) return date;
    throw new BadRequestException('Data de nascimento invalida.');
  }
  const date = new Date(`${value}T12:00:00.000Z`);
  if (Number.isNaN(date.getTime())) throw new BadRequestException('Data de nascimento invalida.');
  return date;
}

const PAIN_DETAIL_KEYS = [
  'pain_detail_knee', 'pain_detail_ankle', 'pain_detail_foot', 'pain_detail_shin', 'pain_detail_calf',
  'pain_detail_thigh', 'pain_detail_hip', 'pain_detail_glute', 'pain_detail_lower_back',
];

function painSummary(answers: Record<string, Prisma.InputJsonValue>) {
  const regions = stringArray(answers.pain_regions);
  if (!regions.length) return 'regiao nao informada';
  const details = PAIN_DETAIL_KEYS.flatMap((key) => stringArray(answers[key]));
  const other = stringValue(answers.pain_other_location);
  const parts = [regions.join(', ')];
  if (details.length) parts.push(`detalhes: ${details.join(', ')}`);
  if (other) parts.push(`outro local: ${other}`);
  return parts.join(' - ');
}

// Mesmas chaves lidas por interviewAddressSummary — uma unica lista, nunca duas listas que podem
// divergir (ver syncIdentityAnswerToUser em MeService).
const ADDRESS_ANSWER_KEYS = new Set([
  'personal_address_street', 'personal_address_number', 'personal_address_complement',
  'personal_address_neighborhood', 'personal_address_city', 'personal_address_state', 'personal_cep',
]);

function interviewAddressSummary(answers: Record<string, Prisma.InputJsonValue>): string | undefined {
  const street = stringValue(answers.personal_address_street);
  const number = stringValue(answers.personal_address_number);
  const complement = stringValue(answers.personal_address_complement);
  const neighborhood = stringValue(answers.personal_address_neighborhood);
  const city = stringValue(answers.personal_address_city);
  const state = stringValue(answers.personal_address_state);
  const cep = stringValue(answers.personal_cep);
  const streetLine = [street, number].filter(Boolean).join(', ');
  const parts = [streetLine, complement, neighborhood, city && state ? `${city}/${state}` : city || state, cep].filter(Boolean);
  return parts.length ? parts.join(' - ') : undefined;
}

const HEALTH_CONDITION_SLUGS: Record<string, string> = {
  Hipertensao: 'hipertensao', Diabetes: 'diabetes', 'Colesterol elevado': 'colesterol', Obesidade: 'obesidade',
  Asma: 'asma', 'Problemas cardiacos': 'cardiaco', Artrose: 'artrose', Artrite: 'artrite', 'Hernia de disco': 'hernia_disco',
};

function healthConditionsSummary(answers: Record<string, Prisma.InputJsonValue>) {
  const conditions = stringArray(answers.health_conditions).filter((item) => item !== 'Nenhuma');
  if (!conditions.length) return 'Nenhuma informada';
  return conditions.map((condition) => {
    if (condition === 'Outra') {
      const other = stringValue(answers.health_conditions_other);
      return other ? `Outra: ${other}` : 'Outra';
    }
    const slug = HEALTH_CONDITION_SLUGS[condition];
    const status = slug ? String(answers[`health_condition_status_${slug}`] ?? '') : '';
    const statusLabel = status === 'current' ? 'atual' : status === 'past' ? 'diagnostico anterior, sem a condicao atualmente' : '';
    return statusLabel ? `${condition} (${statusLabel})` : condition;
  }).join(', ');
}

const RUNNING_CONDITION_SLUGS: Record<string, string> = {
  'Sindrome da banda iliotibial (joelho do corredor)': 'itb', 'Sindrome da dor patelofemoral': 'patelofemoral',
  'Condromalacia patelar': 'condromalacia', 'Tendinopatia patelar (joelho do saltador)': 'tendinopatia_patelar',
  'Tendinopatia do quadriceps': 'tendinopatia_quadriceps', 'Sindrome da pata de ganso (bursite pes anserino)': 'pata_ganso',
  'Bursite pre-patelar': 'bursite_prepatelar', 'Fascite plantar': 'fascite_plantar', 'Esporao de calcaneo': 'esporao_calcaneo',
  'Tendinopatia de Aquiles': 'tendinopatia_aquiles', 'Tendinopatia do tibial posterior': 'tendinopatia_tibial_posterior',
  'Canelite (sindrome do estresse tibial medial)': 'canelite', 'Sindrome do compartimento tibial anterior': 'compartimento_tibial',
  'Fratura por estresse': 'fratura_estresse', 'Neuroma de Morton': 'neuroma_morton', Metatarsalgia: 'metatarsalgia',
  'Entorse de tornozelo (ligamentos)': 'entorse_tornozelo', 'Instabilidade cronica de tornozelo': 'instabilidade_tornozelo',
  'Sindrome do tunel do tarso': 'tunel_tarso', 'Bursite trocanterica': 'bursite_trocanterica', 'Sindrome do piriforme': 'piriforme',
  'Tendinopatia dos isquiotibiais': 'tendinopatia_isquiotibiais', 'Distensao muscular (estiramento)': 'distensao_muscular',
  'Ruptura ou lesao de menisco': 'lesao_menisco', 'Ruptura de ligamento do joelho (LCA/LCM/LCL)': 'ligamento_joelho',
  'Artrose de joelho': 'artrose_joelho', 'Artrose de quadril': 'artrose_quadril', 'Bursite isquiatica': 'bursite_isquiatica',
  'Distensao do adutor (virilha)': 'distensao_adutor', 'Lombalgia mecanica': 'lombalgia', 'Hernia de disco': 'hernia_disco_corredor',
  'Protrusao discal': 'protrusao_discal', 'Dor ciatica (ciatalgia)': 'dor_ciatica',
};

function diagnosedConditionsSummary(answers: Record<string, Prisma.InputJsonValue>) {
  const conditions = stringArray(answers.diagnosed_running_conditions).filter((item) => item !== 'Nenhuma' && item !== 'Nao sei responder');
  const other = stringValue(answers.diagnosed_running_conditions_other);
  if (!conditions.length && !other) return '';
  const described = conditions.map((condition) => {
    const slug = RUNNING_CONDITION_SLUGS[condition];
    const status = slug ? String(answers[`running_condition_status_${slug}`] ?? '') : '';
    const statusLabel = status === 'current' ? 'atual' : status === 'past' ? 'diagnostico anterior, sem a condicao atualmente' : '';
    return statusLabel ? `${condition} (${statusLabel})` : condition;
  });
  return `Diagnosticos: ${[...described, other].filter(Boolean).join(', ')}`;
}

function interviewInjurySummary(answers: Record<string, Prisma.InputJsonValue>) {
  const parts = [
    answers.current_pain === 'yes' ? `Dor atual: ${painSummary(answers)}` : 'Sem dor atual',
    `Lesao previa: ${stringValue(answers.important_injury) || 'nao informada'}`,
    stringValue(answers.injury_description),
    diagnosedConditionsSummary(answers),
    stringValue(answers.medical_recommendation),
  ].filter(Boolean);
  return parts.join('. ');
}

function decimalValue(value: unknown) {
  if (value === undefined || value === null || value === '' || value === 'unknown') return null;
  const number = Number(String(value).replace(',', '.'));
  return Number.isFinite(number) ? number : null;
}

function roundedMeasurement(value: number) {
  return Math.round(value * 10) / 10;
}

// Valores canonicos de User.sex (os mesmos da entrevista; o menu do ciclo menstrual compara com "Feminino"). Formas minusculas antigas viram canonicas; o placeholder
// nunca sobrescreve um sexo ja' informado.
export function normalizeSex(value: string): string {
  const lower = value.trim().toLowerCase();
  if (lower === 'feminino') return 'Feminino';
  if (lower === 'masculino') return 'Masculino';
  return value;
}
export function resolveSexToSave(incoming: string, current: string | null): string {
  if (incoming === 'prefiro_nao_informar' && current) return current;
  return normalizeSex(incoming);
}

function harrisBenedict(input: { sex: string; birthDate: Date; heightCm: number | null; weightKg: number | null }) {
  if (!input.heightCm || !input.weightKg || !['Feminino', 'Masculino'].includes(input.sex)) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - input.birthDate.getUTCFullYear();
  const birthdayPassed = now.getUTCMonth() > input.birthDate.getUTCMonth()
    || (now.getUTCMonth() === input.birthDate.getUTCMonth() && now.getUTCDate() >= input.birthDate.getUTCDate());
  if (!birthdayPassed) age -= 1;
  const value = input.sex === 'Masculino'
    ? 88.362 + 13.397 * input.weightKg + 4.799 * input.heightCm - 5.677 * age
    : 447.593 + 9.247 * input.weightKg + 3.098 * input.heightCm - 4.330 * age;
  return Math.round(value);
}
