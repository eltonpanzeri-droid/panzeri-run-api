import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmailService } from '../messaging/email.service';
import { MessagingService } from '../messaging/messaging.service';
import { NotificationsService } from '../notifications/notifications.service';
import { StudentAccessService, type StudentAccessRow } from './student-access.service';

// Convite para baixar o Panzeri Run nas lojas (08/11/2026, pedido de Elton): e-mail + aviso no sino para quem ainda usa so' o navegador/PWA.
// REGRAS: (1) o envio so' acontece por acao explicita do treinador no painel, com a contagem confirmada; (2) um teste vai SO' para o e-mail de quem pediu;
// (3) cada aluna recebe UMA vez (MessageLog trigger + externalRef da notificacao); (4) audiencia = alunas ATUAIS (confirmada, cortesia, atrasada), fora contas de teste/revisao,
// prospectos e ex-alunas, e classificadas como "provavelmente so' navegador" — estimativa, o servidor nao guarda a plataforma do aparelho.
export const NATIVE_INVITE_TRIGGER = 'native_app_invite';
export const NATIVE_INVITE_NOTIFICATION_TYPE = 'native_app_invite';
export const NATIVE_INVITE_REF = 'native_app_invite_v1';
export const NATIVE_INVITE_SUBJECT = 'Agora o Panzeri Run está na loja do seu celular';
const ELIGIBLE_GROUPS = ['confirmed', 'courtesy', 'overdue'];

export function isInviteRecipient(row: Pick<StudentAccessRow, 'access' | 'paymentGroup'>): boolean {
  return row.access === 'browser_probable' && ELIGIBLE_GROUPS.includes(row.paymentGroup);
}

export function nativeInviteLinks(baseUrl: string) {
  const base = baseUrl.replace(/\/+$/, '');
  const utm = 'utm_source=email&utm_medium=convite&utm_campaign=pwa_para_nativo';
  return { apple: `${base}/ir/apple?${utm}`, play: `${base}/ir/play?${utm}` };
}

export function buildNativeInviteEmail(name: string | null | undefined, links: { apple: string; play: string }): { subject: string; content: string } {
  const first = (name ?? '').trim().split(/\s+/)[0] || 'tudo bem';
  const greeting = (name ?? '').trim() ? `Olá, ${first}!` : 'Olá!';
  const content = [
    greeting,
    '',
    'Você ainda usa o Panzeri Run pelo navegador. Agora ele está disponível na loja do seu celular, e vale a pena trocar:',
    '',
    '• Atualizações automáticas: a loja mantém o Panzeri Run sempre na versão mais nova. Você não precisa apagar e reinstalar o ícone para receber as correções.',
    '• Treinos do relógio sincronizados: no iPhone, pelo Apple Saúde (Apple Watch); no Android, pelo Health Connect (Galaxy Watch e outros). Os treinos que você faz no relógio chegam ao Panzeri Run para serem comparados com o que foi prescrito.',
    '• Avisos no celular: você é avisada quando o seu programa de treino da semana fica pronto.',
    '',
    'Como instalar:',
    `iPhone (App Store): ${links.apple}`,
    `Android (Google Play): ${links.play}`,
    '',
    'Entre com o mesmo e-mail e a mesma senha de sempre. Seu programa de treino, seu histórico e seus feedbacks continuam lá.',
    '',
    'Qualquer dúvida, é só falar com o seu treinador.',
    '',
    'Panzeri Run',
  ].join('\n');
  return { subject: NATIVE_INVITE_SUBJECT, content };
}

export interface NativeInviteRecipient { id: string; studentCode: number | null; name: string | null; email: string; paymentGroup: string; alreadySent: boolean }

@Injectable()
export class NativeInviteService {
  private readonly logger = new Logger(NativeInviteService.name);
  private running = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly studentAccess: StudentAccessService,
    private readonly messaging: MessagingService,
    private readonly email: EmailService,
    private readonly notifications: NotificationsService,
  ) {}

  private links() {
    return nativeInviteLinks(process.env.APP_PUBLIC_URL ?? 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host');
  }

  async recipients(): Promise<NativeInviteRecipient[]> {
    const access = await this.studentAccess.run();
    const rows = access.rows.filter(isInviteRecipient);
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [users, logs] = await Promise.all([
      this.prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, email: true } }),
      this.prisma.messageLog.findMany({ where: { userId: { in: ids }, trigger: NATIVE_INVITE_TRIGGER, status: 'sent' }, select: { userId: true } }),
    ]);
    const emailOf = new Map(users.map((user) => [user.id, user.email]));
    const sent = new Set(logs.map((log) => log.userId));
    return rows
      .filter((row) => emailOf.get(row.id))
      .map((row) => ({ id: row.id, studentCode: row.studentCode, name: row.name, email: emailOf.get(row.id) as string, paymentGroup: row.paymentGroup, alreadySent: sent.has(row.id) }));
  }

  async preview() {
    const all = await this.recipients();
    const pending = all.filter((r) => !r.alreadySent);
    const sample = buildNativeInviteEmail(pending[0]?.name ?? 'Maria Exemplo', this.links());
    return {
      toSend: pending.length,
      alreadySent: all.length - pending.length,
      recipients: all.map(({ email: _email, ...rest }) => rest),
      subject: sample.subject,
      sample: sample.content,
      notes: ['Audiência estimada: alunas atuais sem notificação registrada e sem Health Connect nem Apple Saúde conectados. Cada aluna recebe uma vez.'],
    };
  }

  /** Teste: o e-mail sai SÓ para o endereço de quem pediu (nunca para alunas). */
  async sendTest(coachUserId: string) {
    const coach = await this.prisma.user.findUnique({ where: { id: coachUserId }, select: { email: true, name: true } });
    if (!coach?.email) throw new BadRequestException('Não encontrei o seu e-mail para o teste.');
    const message = buildNativeInviteEmail(coach.name, this.links());
    const result = await this.email.send(coach.email, `[TESTE] ${message.subject}`, message.content);
    if (!result.ok) throw new BadRequestException(`O teste não saiu: ${result.error ?? 'erro desconhecido'}.`);
    return { ok: true, sentTo: coach.email };
  }

  /** Envio real. `expectedCount` precisa bater com o que o servidor conta agora (evita enviar para uma lista que mudou). */
  async sendAll(expectedCount: number) {
    if (this.running) throw new BadRequestException('Já existe um envio em andamento. Aguarde terminar.');
    this.running = true;
    try {
      const pending = (await this.recipients()).filter((r) => !r.alreadySent);
      if (!Number.isInteger(expectedCount) || expectedCount !== pending.length) {
        throw new BadRequestException(`A lista mudou: agora são ${pending.length} alunas a receber. Atualize a tela e confirme de novo.`);
      }
      const links = this.links();
      let sent = 0;
      const failed: Array<{ studentCode: number | null; name: string | null; error: string }> = [];
      for (const recipient of pending) {
        // Rechecagem imediatamente antes de cada envio (segurança contra dois cliques/execuções).
        if (await this.messaging.hasEverSentTrigger(recipient.id, NATIVE_INVITE_TRIGGER)) continue;
        const message = buildNativeInviteEmail(recipient.name, links);
        const result = await this.messaging.sendEmail(recipient.id, { subject: message.subject, content: message.content, trigger: NATIVE_INVITE_TRIGGER });
        if (!result.ok) { failed.push({ studentCode: recipient.studentCode, name: recipient.name, error: result.error ?? 'erro' }); continue; }
        sent += 1;
        await this.notifications
          .notifyUserIfNotRecent(
            recipient.id,
            { title: 'Baixe o Panzeri Run na loja', message: 'Atualizações automáticas e sincronização do relógio. Veja o convite no seu e-mail ou procure Panzeri Run na App Store ou no Google Play.', type: NATIVE_INVITE_NOTIFICATION_TYPE, externalRef: NATIVE_INVITE_REF },
            24,
          )
          .catch((error) => this.logger.warn(`Convite: aviso no sino falhou para ${recipient.id}: ${(error as Error).message}`));
      }
      return { sent, failed };
    } finally {
      this.running = false;
    }
  }
}
