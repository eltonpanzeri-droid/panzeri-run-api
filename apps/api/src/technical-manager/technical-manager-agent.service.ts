import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';
import { StravaService } from '../strava/strava.service';
import { AiQueueService } from '../common/ai-queue.service';
import { sanitizeInterviewAnswers } from '../training-plans/training-methodology';

const MAX_TOOL_ITERATIONS = 6;
const HISTORY_LIMIT = 40;

interface ToolDefinition {
  spec: Anthropic.Tool;
  run: (input: Record<string, unknown>) => Promise<string>;
}

@Injectable()
export class TechnicalManagerAgentService {
  private readonly logger = new Logger(TechnicalManagerAgentService.name);
  private readonly client: Anthropic | null;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly strava: StravaService,
    private readonly aiQueue: AiQueueService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    this.client = apiKey ? new Anthropic({ apiKey }) : null;
  }

  async history(studentId: string) {
    return this.prisma.coachChatMessage.findMany({
      where: { userId: studentId },
      orderBy: { createdAt: 'asc' },
      take: HISTORY_LIMIT,
    });
  }

  async directives(studentId: string) {
    return this.prisma.studentDirective.findMany({
      where: { userId: studentId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deactivateDirective(studentId: string, directiveId: string) {
    const directive = await this.prisma.studentDirective.findFirst({ where: { id: directiveId, userId: studentId } });
    if (!directive) {
      throw new BadRequestException('Diretriz nao encontrada.');
    }
    return this.prisma.studentDirective.update({ where: { id: directiveId }, data: { active: false } });
  }

  async chat(studentId: string, message: string): Promise<{ reply: string }> {
    if (!this.client) {
      throw new BadRequestException('Agente gerente tecnico nao configurado (falta ANTHROPIC_API_KEY).');
    }
    if (!message.trim()) {
      throw new BadRequestException('Escreva uma mensagem.');
    }

    const student = await this.prisma.user.findUniqueOrThrow({ where: { id: studentId }, select: { name: true } });

    await this.prisma.coachChatMessage.create({ data: { userId: studentId, role: 'coach', content: message } });

    const history = await this.history(studentId);
    const messages: Anthropic.MessageParam[] = history.map((item) => ({
      role: item.role === 'coach' ? 'user' : 'assistant',
      content: item.content,
    }));

    const tools = this.buildTools(studentId);

    const reply = await this.aiQueue.run(() => this.runConversation(student.name, messages, tools));

    await this.prisma.coachChatMessage.create({ data: { userId: studentId, role: 'agent', content: reply } });

    return { reply };
  }

  private async runConversation(studentName: string, initialMessages: Anthropic.MessageParam[], tools: ToolDefinition[]): Promise<string> {
    const client = this.client!;
    let messages = [...initialMessages];

    for (let iteration = 0; iteration < MAX_TOOL_ITERATIONS; iteration += 1) {
      const response = await client.messages.create({
        model: 'claude-opus-4-8',
        max_tokens: 2000,
        system: this.buildSystemPrompt(studentName),
        tools: tools.map((tool) => tool.spec),
        messages,
      });

      const toolUseBlocks = response.content.filter((block): block is Anthropic.ToolUseBlock => block.type === 'tool_use');

      if (response.stop_reason !== 'tool_use' || !toolUseBlocks.length) {
        const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
        return textBlock?.text?.trim() || 'Nao consegui gerar uma resposta.';
      }

      messages = [...messages, { role: 'assistant', content: response.content }];

      const toolResults: Anthropic.ToolResultBlockParam[] = [];
      for (const block of toolUseBlocks) {
        const tool = tools.find((candidate) => candidate.spec.name === block.name);
        let content: string;
        try {
          content = tool ? await tool.run((block.input ?? {}) as Record<string, unknown>) : 'Ferramenta desconhecida.';
        } catch (error) {
          content = `Erro ao executar a ferramenta: ${(error as Error).message}`;
        }
        toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
      }
      messages = [...messages, { role: 'user', content: toolResults }];
    }

    this.logger.warn('Conversa com o agente gerente tecnico excedeu o limite de chamadas de ferramentas.');
    return 'Precisei consultar varias informacoes e nao consegui concluir a resposta. Tente reformular a pergunta de forma mais direta.';
  }

  private buildTools(studentId: string): ToolDefinition[] {
    return [
      {
        spec: {
          name: 'get_student_context',
          description: 'Retorna o contexto completo do aluno: respostas da entrevista, preferencias, historico de testes de 3 km, resumo do plano de treino ativo (aderencia, km) e as diretrizes especificas ja ativas para este aluno.',
          input_schema: { type: 'object', properties: {} },
        },
        run: async () => JSON.stringify(await this.gatherStudentContext(studentId), null, 2),
      },
      {
        spec: {
          name: 'get_strava_report',
          description: 'Retorna o relatorio de execucao do Strava do aluno para a semana ativa: prescrito x realizado, aderencia, tendencia de carga.',
          input_schema: { type: 'object', properties: {} },
        },
        run: async () => JSON.stringify(await this.strava.report(studentId), null, 2),
      },
      {
        spec: {
          name: 'save_directive',
          description: 'Salva uma diretriz para este aluno, que o agente de prescricao de treinos vai OBRIGATORIAMENTE consultar e respeitar em toda geracao futura de treino — tanto na geracao automatica semanal quanto quando o treinador pedir para regenerar a semana manualmente. Pode ser permanente (sem data de validade) ou temporaria (com data de validade, ex: ate uma prova ou por algumas semanas). So use depois que o treinador confirmar explicitamente, em uma mensagem anterior, que quer salvar aquilo.',
          input_schema: {
            type: 'object',
            properties: {
              content: { type: 'string', description: 'A diretriz em texto objetivo e acionavel, com todos os detalhes combinados (datas, distancias, paces, etc). Ex: "Longao de 16 km em 25/07, depois 10 km em 01/08, volume maior ate 03/08, taper de 03/08 a 09/08 (reduzir volume/intensidade, sem treinos abaixo de 5 km), pace 5:40-6:20/km nos treinos curtos e 6:20-7:00/km nos longos, prova alvo em 09/08."' },
              expiresAt: { type: 'string', description: 'Data (AAAA-MM-DD) ate quando essa diretriz vale, para instrucoes temporarias/com prazo (ex: ate uma prova, ou por algumas semanas). Deixe de fora (nao inclua o campo) para diretrizes permanentes, sem prazo.' },
            },
            required: ['content'],
          },
        },
        run: async (input) => {
          const content = String(input.content ?? '').trim();
          if (!content) return 'Erro: conteudo da diretriz vazio.';
          const expiresAtRaw = input.expiresAt ? String(input.expiresAt).trim() : '';
          const expiresAt = expiresAtRaw ? new Date(`${expiresAtRaw}T23:59:59.000Z`) : undefined;
          if (expiresAtRaw && Number.isNaN(expiresAt?.getTime())) return 'Erro: data de validade invalida, use o formato AAAA-MM-DD.';
          const created = await this.prisma.studentDirective.create({ data: { userId: studentId, content, expiresAt } });
          return expiresAt
            ? `Diretriz temporaria salva com sucesso (id: ${created.id}), valida ate ${expiresAtRaw}.`
            : `Diretriz permanente salva com sucesso (id: ${created.id}).`;
        },
      },
      {
        spec: {
          name: 'deactivate_directive',
          description: 'Desativa uma diretriz existente deste aluno, por exemplo quando o treinador pede para revogar ou substituir uma regra anterior.',
          input_schema: {
            type: 'object',
            properties: {
              directiveId: { type: 'string', description: 'O id da diretriz a desativar, obtido via get_student_context.' },
            },
            required: ['directiveId'],
          },
        },
        run: async (input) => {
          const directiveId = String(input.directiveId ?? '');
          const directive = await this.prisma.studentDirective.findFirst({ where: { id: directiveId, userId: studentId } });
          if (!directive) return 'Erro: diretriz nao encontrada.';
          await this.prisma.studentDirective.update({ where: { id: directiveId }, data: { active: false } });
          return 'Diretriz desativada com sucesso.';
        },
      },
    ];
  }

  private async gatherStudentContext(studentId: string) {
    const [user, onboarding, tests, directives, activePlan] = await Promise.all([
      this.prisma.user.findUniqueOrThrow({ where: { id: studentId }, include: { preferences: true, healthProfile: true } }),
      this.prisma.onboardingInterview.findUnique({ where: { userId: studentId }, select: { answers: true } }),
      this.prisma.fitnessTest.findMany({ where: { userId: studentId, testType: '3km' }, orderBy: { createdAt: 'desc' }, take: 5 }),
      this.prisma.studentDirective.findMany({ where: { userId: studentId, active: true, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] }, orderBy: { createdAt: 'desc' } }),
      this.prisma.trainingPlan.findFirst({
        where: { userId: studentId, status: 'active' },
        orderBy: { createdAt: 'desc' },
        include: { sessions: { include: { completion: true } } },
      }),
    ]);

    return {
      nome: user.name,
      objetivo: user.preferences?.mainGoal ?? null,
      experiencia: user.preferences?.experienceLevel ?? null,
      saude: user.healthProfile ? {
        sono: user.healthProfile.averageSleep,
        estresse: user.healthProfile.stressLevel,
        lesoesAnteriores: user.healthProfile.previousInjuries,
      } : null,
      respostasEntrevista: onboarding?.answers ? sanitizeInterviewAnswers(onboarding.answers as Record<string, unknown>) : null,
      historicoTestes3km: tests.map((test) => ({
        data: test.createdAt.toISOString().slice(0, 10),
        paceSegundosPorKm: test.paceSecondsPerKm,
        totalSegundos: test.totalSeconds,
      })),
      planoAtivo: activePlan ? {
        nome: activePlan.name,
        sessoes: activePlan.sessions.length,
        concluidas: activePlan.sessions.filter((session) => session.completion?.status === 'done' || session.completion?.status === 'adjusted').length,
      } : null,
      diretrizesAtivas: directives.map((directive) => ({ id: directive.id, conteudo: directive.content, desde: directive.createdAt.toISOString().slice(0, 10) })),
    };
  }

  private buildSystemPrompt(studentName: string) {
    return [
      `Voce e o agente gerente tecnico da Panzeri Run, conversando com Elton Panzeri (o treinador responsavel tecnico) sobre a aluna/aluno ${studentName}.`,
      'Pense na estrutura como uma academia: existe um agente que monta o treino da semana (o "professor") e um agente que analisa dados do Strava. Voce e a ponte entre o treinador e esses agentes — o gerente tecnico que recebe orientacoes especificas sobre um aluno e garante que elas sejam seguidas.',
      'Voce pode consultar o contexto completo do aluno (get_student_context) e o relatorio de execucao do Strava (get_strava_report) para responder com informacao real, nunca invente dados.',
      'Quando o treinador pedir sua opiniao, de uma opiniao tecnica real baseada nos dados, como um profissional experiente faria — nao seja generico ou evasivo.',
      'REGRA MAIS IMPORTANTE sobre diretrizes permanentes: quando o treinador pedir para voce criar uma regra fixa/permanente para este aluno especifico, primeiro responda em texto confirmando exatamente o que sera salvo (ex: "Entendido, vou aplicar isso para a Juliana a partir de agora: ..."). So chame a ferramenta save_directive depois que o treinador confirmar explicitamente numa mensagem seguinte (ex: "sim", "pode salvar", "confirmado"). Nunca chame save_directive na mesma resposta em que voce esta pedindo a confirmacao.',
      'O agente que gera os treinos (tanto na geracao automatica semanal quanto quando o treinador pede para regenerar a semana) NAO participa desta conversa e NAO tem acesso a ela — a UNICA forma de qualquer combinado aqui realmente virar treino de verdade e voce salvar isso com save_directive. Se o treinador combinar algo especifico com voce (datas, distancias, paces, taper, etc) e voce nao salvar, isso sera perdido e o proximo treino gerado vai ignorar tudo o que foi conversado — isso e um erro grave, entao nunca diga para o treinador "editar a sessao manualmente" ou "regenerar o treino" como se isso fosse aplicar o combinado sozinho; regenerar so aplica o que estiver salvo como diretriz.',
      'Sempre que o treinador confirmar um ajuste, identifique se ele tem prazo (ate uma data, ate uma prova, por N semanas) ou se e uma regra permanente. Se tiver prazo, salve com save_directive incluindo expiresAt (AAAA-MM-DD) correspondente ao ultimo dia em que o ajuste deve valer. Se for permanente, salve sem expiresAt. Em ambos os casos, so salve depois que o treinador confirmar explicitamente que quer aquilo aplicado — nunca salve so por voce ter sugerido algo.',
      'Diretrizes salvas devem ser curtas, objetivas e acionaveis, mas sem perder os detalhes concretos combinados (datas, distancias em km, paces em min/km, etc) — nao salve conversas inteiras, resuma em um paragrafo curto e especifico.',
      'Responda sempre em portugues, em tom direto e profissional, como uma conversa entre dois profissionais tecnicos.',
    ].join('\n\n');
  }
}
