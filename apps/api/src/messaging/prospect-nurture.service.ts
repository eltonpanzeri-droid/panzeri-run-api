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
// sempre o mesmo mecanismo (link magico de login), o que muda e' so o texto do call-to-action —
// depois de logada, a propria tela do app ja mostra a entrevista pendente OU o botao de pagamento,
// sem precisar de nenhuma logica extra aqui.
function nextStepLine(level: ProspectLevel, loginUrl: string): string {
  if (level === 'quente') {
    return `Sua entrevista ja esta pronta — falta so confirmar o pagamento pra eu montar seu primeiro treino.\n\n[Finalizar pagamento] ${loginUrl}`;
  }
  if (level === 'morno') {
    return `Voce ja respondeu parte da entrevista — falta so terminar pra eu montar seu treino personalizado.\n\n[Continuar de onde parei] ${loginUrl}`;
  }
  return `Leva menos de 3 minutos pra terminar seu cadastro e eu ja consigo montar seu primeiro treino.\n\n[Continuar de onde parei] ${loginUrl}`;
}

function buildEmail(trigger: string, name: string, level: ProspectLevel, loginUrl: string): { subject: string; content: string } {
  const step = nextStepLine(level, loginUrl);

  if (trigger === 'nurture_8h') {
    return {
      subject: `Faltou só um passo, ${name}`,
      content: `Oi ${name}, tudo bem?\n\nVi que você começou seu cadastro no Panzeri Run mas não terminou. Sem problema — às vezes o dia corre e a gente esquece.\n\n${step}\n\nQualquer dúvida, é só responder este e-mail — respondo pessoalmente.\n\nElton`,
    };
  }

  if (trigger === 'nurture_24h') {
    return {
      subject: '"Corrida não é pra mim" — será mesmo?',
      content: `${name}, imagino que uma das dúvidas na sua cabeça seja: "será que eu aguento", "sou muito iniciante pra isso".\n\nIsso é exatamente o que eu resolvo. O treino não é genérico — é montado pra ONDE você está hoje, não pra onde você "deveria" estar. Se você nunca correu, começamos do jeito certo, sem lesão, sem sofrimento desnecessário. Se já corre, ajustamos pro seu ritmo real.\n\nE não é um app "solto" — sou eu acompanhando de verdade, ajustando quando algo não está funcionando.\n\nCusta R$19,90/mês e você pode cancelar quando quiser, sem multa.\n\n${step}\n\nElton`,
    };
  }

  if (trigger === 'nurture_7d') {
    return {
      subject: `Uma pergunta rápida, ${name}`,
      content: `${name}, faz uma semana que você chegou até aqui e parou. Queria entender: o que travou?\n\n- "Não tenho tempo pra treinar direito" — o programa se adapta à sua rotina, não o contrário. Você me diz quantos dias tem disponível, eu monto em cima disso.\n- "Não sei se vale o dinheiro" — R$19,90/mês é menos que uma corrida de app de transporte. E você tem acompanhamento humano, não só um algoritmo.\n- "Tenho medo de me machucar treinando errado" — é justamente o oposto do que costuma acontecer sozinho: eu ajusto intensidade e volume pra evitar lesão, não pra empurrar além do limite.\n\nSe for outra coisa, me conta — respondo pessoalmente. Se quiser só retomar:\n\n${step}\n\nElton`,
    };
  }

  // nurture_30d
  return {
    subject: 'Ainda pensando em correr de verdade este ano?',
    content: `${name}, faz um mês desde que você criou sua conta no Panzeri Run. Não vou insistir mais depois deste — só queria deixar a porta aberta.\n\nSe o motivo foi "não é a hora", tudo bem, sem problema nenhum. Mas se foi dúvida, preço ou medo de não conseguir seguir, eu topo conversar antes — é só responder este e-mail.\n\nSe quiser voltar quando fizer sentido pra você, seu cadastro continua aqui, esperando:\n\n${step}\n\nUm abraço,\nElton`,
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
        onboardingInterview: { select: { completedAt: true, currentStep: true, answers: true } },
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
          interviewCompletedAt: prospect.onboardingInterview?.completedAt,
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
