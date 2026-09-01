import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { AuthService } from '../auth/auth.service';
import { MessagingService } from './messaging.service';
import { computeProspectLevel, ProspectLevel } from './prospect-level';

// Sequencia de aquecimento pra quem criou conta mas nunca virou aluno de verdade (18/08, pedido
// explicito do treinador + especificacao trazida por ele em documento externo — ver
// [[prospect_nurture_emails]]). Roda de hora em hora (nao diario, porque o primeiro degrau e' em
// 8h — um cron diario deixaria a janela imprecisa demais). Cada degrau dispara UMA vez na vida do
// cadastro; a elegibilidade (ainda esta 'pending'?) e' sempre recalculada NA HORA do envio, nunca
// decidida antecipadamente — assim, quem pagar entre uma rodada e outra do cron simplesmente para
// de aparecer na consulta e nunca mais recebe nada dessa sequencia (nao precisa de logica de
// cancelamento separada).
const STAGE_GATES: Array<{ trigger: string; afterHours: number }> = [
  { trigger: 'nurture_8h', afterHours: 8 },
  { trigger: 'nurture_24h', afterHours: 24 },
  { trigger: 'nurture_7d', afterHours: 24 * 7 },
  { trigger: 'nurture_30d', afterHours: 24 * 30 },
];

function studentAppUrl() {
  return process.env.STUDENT_APP_URL ?? 'https://agenteselton-panzeri-run-app.hbljgk.easypanel.host';
}

// A linha de "proximo passo" muda de acordo com o que a pessoa realmente ja fez ate agora — nao
// faz sentido pedir pra "terminar a entrevista" pra quem ja terminou e so falta pagar. O link e'
// sempre o mesmo mecanismo (link magico de login) — o que muda e' o texto do call-to-action E pra
// onde a propria tela do app leva depois de logar: 01/09, corrigido `App.tsx` pra levar direto pra
// aba de assinatura quando as 5 perguntas rapidas ja foram respondidas mas o pagamento nao (antes
// caia na aba "Semana", sem plano nenhum pra mostrar, contradizendo o "falta so pagar" do e-mail).
// Sem isso, o link "magico" sempre existiu (fallback garantido: se o token ja expirou/foi usado, o
// app cai sozinho na tela de login normal, nunca quebra) — o que faltava era o destino certo depois
// de logar.
function nextStepLine(level: ProspectLevel, loginUrl: string): string {
  if (level === 'quente') {
    return `>> Finalizar pagamento agora: ${loginUrl}\n\nVocê já respondeu tudo — essa é a última etapa antes de eu montar seu primeiro treino.`;
  }
  if (level === 'morno') {
    return `>> Continuar de onde parei: ${loginUrl}\n\nO link já abre exatamente na pergunta em que você parou — não precisa recomeçar nada.`;
  }
  return `>> Começar agora (menos de 3 minutos): ${loginUrl}\n\nSão só 5 perguntas rápidas pra eu já ter o que preciso pra montar seu primeiro treino.`;
}

function buildEmail(trigger: string, name: string, level: ProspectLevel, loginUrl: string): { subject: string; content: string } {
  const step = nextStepLine(level, loginUrl);

  if (trigger === 'nurture_8h') {
    return {
      subject: level === 'quente' ? `${name}, seu treino está a um passo de sair` : `Faltou só um passo, ${name}`,
      content: level === 'quente'
        ? `Oi ${name}!\n\nVocê já respondeu tudo o que eu precisava saber pra montar o seu treino — só falta confirmar o pagamento pra eu liberar.\n\n${step}\n\nLeva menos de 1 minuto. Qualquer dúvida, é só responder este e-mail — respondo pessoalmente.\n\nElton`
        : `Oi ${name}, tudo bem?\n\nVi que você começou seu cadastro no Panzeri Run mas não terminou. Sem problema — às vezes o dia corre e a gente esquece. O que importa é que o seu treino personalizado está a poucos minutos de existir.\n\n${step}\n\nQualquer dúvida, é só responder este e-mail — respondo pessoalmente.\n\nElton`,
    };
  }

  if (trigger === 'nurture_24h') {
    return {
      subject: level === 'quente' ? `Não deixe seu treino esperando, ${name}` : '"Corrida não é pra mim" — será mesmo?',
      content: level === 'quente'
        ? `${name}, você chegou até a última etapa e parou bem ali — não faz sentido perder isso.\n\nSeu treino já está pronto pra ser montado assim que o pagamento confirmar. É R$19,90/mês, cancela quando quiser, sem multa.\n\n${step}\n\nElton`
        : `${name}, imagino que uma das dúvidas na sua cabeça seja: "será que eu aguento", "sou muito iniciante pra isso".\n\nIsso é exatamente o que eu resolvo. O treino não é genérico — é montado pra ONDE você está hoje, não pra onde você "deveria" estar. Se você nunca correu, começamos do jeito certo, sem lesão, sem sofrimento desnecessário. Se já corre, ajustamos pro seu ritmo real.\n\nE não é um app "solto" — sou eu acompanhando de verdade, ajustando quando algo não está funcionando.\n\nCusta R$19,90/mês e você pode cancelar quando quiser, sem multa.\n\n${step}\n\nElton`,
    };
  }

  if (trigger === 'nurture_7d') {
    return {
      subject: level === 'quente' ? `${name}, isso ainda está te esperando` : `Uma pergunta rápida, ${name}`,
      content: level === 'quente'
        ? `${name}, faz uma semana que você terminou de responder tudo e chegou até o pagamento — e parou exatamente ali.\n\nSe foi dúvida sobre o valor: R$19,90/mês é menos que uma corrida de app de transporte, e você tem acompanhamento humano de verdade, não só um algoritmo solto. Se foi outra coisa, me conta — respondo pessoalmente.\n\n${step}\n\nElton`
        : `${name}, faz uma semana que você chegou até aqui e parou. Queria entender: o que travou?\n\n- "Não tenho tempo pra treinar direito" — o programa se adapta à sua rotina, não o contrário. Você me diz quantos dias tem disponível, eu monto em cima disso.\n- "Não sei se vale o dinheiro" — R$19,90/mês é menos que uma corrida de app de transporte. E você tem acompanhamento humano, não só um algoritmo.\n- "Tenho medo de me machucar treinando errado" — é justamente o oposto do que costuma acontecer sozinho: eu ajusto intensidade e volume pra evitar lesão, não pra empurrar além do limite.\n\nSe for outra coisa, me conta — respondo pessoalmente. Se quiser só retomar:\n\n${step}\n\nElton`,
    };
  }

  // nurture_30d
  return {
    subject: level === 'quente' ? `Última chance de aproveitar o que você já fez, ${name}` : 'Ainda pensando em correr de verdade este ano?',
    content: level === 'quente'
      ? `${name}, faz um mês que você terminou tudo — respondeu a entrevista inteira, chegou até o pagamento — e parou. Não vou insistir mais depois deste, só queria deixar a porta aberta pra você não perder o que já fez.\n\nSe foi dúvida ou preço, eu topo conversar antes — é só responder este e-mail. Se quiser só confirmar:\n\n${step}\n\nUm abraço,\nElton`
      : `${name}, faz um mês desde que você criou sua conta no Panzeri Run. Não vou insistir mais depois deste — só queria deixar a porta aberta.\n\nSe o motivo foi "não é a hora", tudo bem, sem problema nenhum. Mas se foi dúvida, preço ou medo de não conseguir seguir, eu topo conversar antes — é só responder este e-mail.\n\nSe quiser voltar quando fizer sentido pra você, seu cadastro continua aqui, esperando:\n\n${step}\n\nUm abraço,\nElton`,
  };
}

@Injectable()
export class ProspectNurtureService {
  private readonly logger = new Logger(ProspectNurtureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly auth: AuthService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async runNurtureSequence() {
    const prospects = await this.prisma.user.findMany({
      where: { role: 'student', accountStatus: { not: 'archived' }, subscriptionStatus: 'pending' },
      select: {
        id: true,
        name: true,
        createdAt: true,
        onboardingInterview: { select: { quickIntakeCompletedAt: true, currentStep: true, answers: true } },
        billingSubscription: { select: { checkoutUrl: true } },
      },
    });

    let sent = 0;
    for (const prospect of prospects) {
      try {
        const ageHours = (Date.now() - prospect.createdAt.getTime()) / 3600000;
        // So o degrau mais recente ainda-nao-enviado que ja venceu — evita disparar varios de
        // uma vez se o cron ficar parado por um tempo e "acumular" degraus vencidos.
        const dueGate = [...STAGE_GATES].reverse().find((gate) => ageHours >= gate.afterHours);
        if (!dueGate) continue;

        const alreadySent = await this.messaging.hasEverSentTrigger(prospect.id, dueGate.trigger);
        if (alreadySent) continue;

        const { level } = computeProspectLevel({
          interviewCurrentStep: prospect.onboardingInterview?.currentStep,
          interviewAnswers: prospect.onboardingInterview?.answers,
          interviewCompletedAt: prospect.onboardingInterview?.quickIntakeCompletedAt,
          hasCheckoutUrl: Boolean(prospect.billingSubscription?.checkoutUrl),
        });

        // Token novo a cada envio — nunca reaproveita entre e-mails/degraus (ver comentario em
        // AuthService.createLoginLink sobre por que a validade e' generosa mas o uso e' unico).
        const loginToken = await this.auth.createLoginLink(prospect.id);
        const loginUrl = `${studentAppUrl()}/?loginToken=${loginToken}`;

        const email = buildEmail(dueGate.trigger, prospect.name, level, loginUrl);
        await this.messaging.sendEmail(prospect.id, { trigger: dueGate.trigger, ...email });
        sent += 1;
      } catch (error) {
        this.logger.warn(`Falha ao rodar aquecimento de prospecto ${prospect.id}: ${(error as Error).message}`);
      }
    }

    if (sent > 0) {
      this.logger.log(`Sequencia de aquecimento de prospectos: ${sent} e-mail(is) enviado(s).`);
    }
    return { checked: prospects.length, sent };
  }
}
