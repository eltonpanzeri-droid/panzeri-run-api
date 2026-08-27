import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from './email.service';

// 27/08: intervalo minimo antes de tentar de novo um degrau de aquecimento que falhou (Resend
// fora do ar, erro pontual) — o cron roda de hora em hora, sem isso uma falha continuada geraria
// tentativa nova, com token de login novo, toda santa hora, pra sempre.
const NURTURE_RETRY_COOLDOWN_HOURS = 6;

@Injectable()
export class MessagingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly emailService: EmailService,
  ) {}

  async sendEmail(userId: string, params: { subject: string; content: string; trigger: string }) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (!user) throw new NotFoundException('Aluno nao encontrado.');

    const result = await this.emailService.send(user.email, params.subject, params.content);

    await this.prisma.messageLog.create({
      data: {
        userId,
        channel: 'email',
        trigger: params.trigger,
        subject: params.subject,
        content: params.content,
        status: result.ok ? 'sent' : 'failed',
        errorDetail: result.error,
        resendEmailId: result.resendEmailId,
      },
    });

    return result;
  }

  async hasRecentTriggerMessage(userId: string, trigger: string, withinDays: number) {
    const since = new Date(Date.now() - withinDays * 86400000);
    const existing = await (this.prisma as any).messageLog.findFirst({
      where: { userId, trigger, createdAt: { gte: since } },
    });
    return Boolean(existing);
  }

  // Usado pelos degraus da jornada de aquecimento de prospectos (8h/24h/7d/30d) — cada degrau
  // dispara UMA vez na vida do cadastro, nao com janela/cooldown como os avisos de cobranca
  // recorrentes.
  // 27/08: so' conta como "ja enviado" (bloqueio permanente) se o status foi 'sent' de verdade —
  // antes checava so' se existia alguma tentativa, entao uma falha real (Resend fora do ar, erro
  // pontual) travava aquele degrau pra sempre. Mas isso sozinho criaria o problema oposto: sem
  // nenhum limite, uma falha continuada tentaria de novo TODA hora, pra sempre, gerando token de
  // login novo a cada tentativa. NURTURE_RETRY_COOLDOWN_HOURS da um intervalo sensato entre
  // tentativas apos uma falha, sem bloquear pra sempre nem martelar hora a hora.
  //
  // O que essa funcao deliberadamente NAO faz: reenviar quando o deliveryStatus vira 'bounced'
  // (a Resend aceitou processar, mas o endereço nao existe de verdade). Reenviar pra um endereço
  // com bounce definitivo nunca resolve nada — o e-mail so' vai bater e voltar de novo — entao a
  // correção certa ali é visibilidade pro treinador corrigir o cadastro (ver
  // CoachService.prospectNurtureLog byDeliveryStatus), nao tentativa automatica.
  async hasEverSentTrigger(userId: string, trigger: string) {
    const sent = await this.prisma.messageLog.findFirst({ where: { userId, trigger, status: 'sent' } });
    if (sent) return true;

    return this.hasRecentTriggerMessage(userId, trigger, NURTURE_RETRY_COOLDOWN_HOURS / 24);
  }

  // 27/08: chamado pelo webhook da Resend quando um e-mail e' entregue, volta (bounce), e' marcado
  // como spam (complaint), aberto ou clicado — atualiza o registro de envio original pelo
  // resendEmailId. So' sobrescreve se o evento novo for "mais importante" que o que ja estava
  // salvo — sem isso, um "opened" chegando depois de um "delivered" apagava a confirmacao de
  // entrega. bounced/complained ficam no topo do ranking de proposito: segundo a propria
  // documentacao da Resend, complaint acontece DEPOIS de uma entrega bem-sucedida (nao antes), e
  // e' o sinal mais critico que existe pra reputacao do remetente — nunca pode ficar escondido
  // atras de um "opened"/"delivered" anterior.
  private static readonly DELIVERY_RANK: Record<string, number> = {
    delivery_delayed: 1,
    delivered: 2,
    opened: 3,
    clicked: 4,
    bounced: 5,
    complained: 6,
  };

  async recordDeliveryEvent(resendEmailId: string, deliveryStatus: string) {
    const existing = await this.prisma.messageLog.findFirst({ where: { resendEmailId }, select: { id: true, deliveryStatus: true } });
    if (!existing) return;

    const newRank = MessagingService.DELIVERY_RANK[deliveryStatus] ?? 0;
    const currentRank = existing.deliveryStatus ? (MessagingService.DELIVERY_RANK[existing.deliveryStatus] ?? 0) : 0;
    // <=, nao so' < : webhook da Resend/Svix e' "pelo menos uma vez" (pode reentregar o mesmo
    // evento) — sem essa igualdade tambem bloqueando, um "delivered" duplicado reescrevia
    // deliveryUpdatedAt com o horario do reenvio, nao o da entrega real.
    if (newRank <= currentRank && existing.deliveryStatus) return;

    await this.prisma.messageLog.update({
      where: { id: existing.id },
      data: { deliveryStatus, deliveryUpdatedAt: new Date() },
    });
  }
}
