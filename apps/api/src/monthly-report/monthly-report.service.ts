import { BadRequestException, Body, Controller, Get, Injectable, Logger, NotFoundException, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron } from '@nestjs/schedule';
import { AuthGuard } from '@nestjs/passport';
import { isRunModality } from '../activity-execution/canonical-modality';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { BestMarksService } from '../best-marks/best-marks.service';
import { CurrentUser, CurrentUserPayload } from '../common/current-user';
import { activityLocalDate } from '../common/local-date';
import { Roles } from '../common/roles.decorator';
import { RolesGuard } from '../common/roles.guard';
import { MessagingService } from '../messaging/messaging.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  MonthlyReportData, ReportActivity, ReportLinks, ReportMark, addMonths, buildMonthlyReport, hasAnyActivity, isMonthKey, optOutToken, previousMonthKey,
  renderMonthlyReportHtml, renderMonthlyReportText, reportSubject, verifyOptOutToken,
} from './monthly-report';

// Relatorio mensal por e-mail (09/11/2026). Todo dia 1, as 9h (Sao Paulo), cada aluna ativa (paga ou cortesia) que treinou no mes anterior recebe o resumo. Quem nao treinou nada nao recebe nada.
// O envio automatico fica DESLIGADO ate MONTHLY_REPORT_ENABLED=true (Elton liga depois de aprovar o e-mail de teste). Nunca envia duas vezes o mesmo mes para a mesma aluna (MessageLog).
const ACCESS_STATUSES = ['active', 'manual_active', 'grace'];
const SEND_GAP_MS = 700; // folga entre envios (limite de requisicoes da Resend)
const DAY_MS = 86_400_000;

const defaultApi = 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
const defaultApp = 'https://agenteselton-panzeri-run-app.hbljgk.easypanel.host';

export interface BuiltReport {
  data: MonthlyReportData;
  hasActivity: boolean;
  subject: string;
  html: string;
  text: string;
  studentName: string;
}

export interface MonthSendSummary { month: string; considered: number; sent: number; skippedNoActivity: number; skippedAlreadySent: number; failed: number; dryRun: boolean }

@Injectable()
export class MonthlyReportService {
  private readonly logger = new Logger(MonthlyReportService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly messaging: MessagingService,
    private readonly bestMarks: BestMarksService,
    private readonly config: ConfigService,
  ) {}

  private secret(): string {
    return this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret';
  }
  private apiUrl(): string {
    return (this.config.get<string>('APP_PUBLIC_URL') ?? defaultApi).replace(/\/$/, '');
  }
  private appUrl(): string {
    return (this.config.get<string>('STUDENT_APP_URL') ?? defaultApp).replace(/\/$/, '');
  }

  linksFor(userId: string, preview: boolean): ReportLinks {
    const unsubscribeUrl = preview ? `${this.apiUrl()}/monthly-report/unsubscribe?preview=1` : `${this.apiUrl()}/monthly-report/unsubscribe?u=${encodeURIComponent(userId)}&t=${optOutToken(this.secret(), userId)}`;
    return { appUrl: this.appUrl(), unsubscribeUrl };
  }

  // Monta o relatorio de UMA aluna para o mes (atividades do mes e do anterior, uma observacao por evento, sem excluidas) — sem enviar nada.
  async build(userId: string, monthKey: string, options: { preview?: boolean } = {}): Promise<BuiltReport> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
    if (!user) throw new NotFoundException('Aluno nao encontrado.');
    const from = new Date(`${addMonths(monthKey, -1)}-01T00:00:00.000Z`);
    const to = new Date(`${addMonths(monthKey, 1)}-01T00:00:00.000Z`);
    const rows = await this.prisma.activityLog.findMany({ where: { userId, startedAt: { gte: new Date(from.getTime() - DAY_MS), lt: new Date(to.getTime() + DAY_MS) } } });
    const picks = await pickCanonicalPerEvent(rows, (ids) => this.prisma.activityLog.findMany({ where: { userId, id: { in: ids } } }));
    const prevKey = addMonths(monthKey, -1);
    const activities: ReportActivity[] = picks
      .map(({ row }) => ({ localDate: activityLocalDate(row.startedAt, row.utcOffsetMinutes), isRun: isRunModality(row.sport), distanceMeters: row.distanceMeters, durationSec: row.durationSec, caloriesKcal: row.caloriesKcal }))
      .filter((activity) => activity.localDate.slice(0, 7) === monthKey || activity.localDate.slice(0, 7) === prevKey);

    const marks = await this.bestMarks.forUser(userId);
    const reportMarks: ReportMark[] = marks.marks.flatMap((entry) => (entry.best ? [{ label: entry.label, seconds: entry.best.seconds, paceSecondsKm: entry.best.paceSecondsKm, localDate: entry.best.localDate }] : []));

    const firstName = (user.name ?? '').trim().split(/\s+/)[0] || 'tudo bem';
    const data = buildMonthlyReport(activities, monthKey, firstName, reportMarks);
    const links = this.linksFor(userId, Boolean(options.preview));
    return { data, hasActivity: hasAnyActivity(data), subject: reportSubject(data), html: renderMonthlyReportHtml(data, links), text: renderMonthlyReportText(data, links), studentName: user.name ?? '' };
  }

  async eligibleStudentIds(): Promise<string[]> {
    const rows = await this.prisma.user.findMany({
      where: { role: 'student', accountStatus: 'active', isTestAccount: false, monthlyReportOptOut: false, subscriptionStatus: { in: ACCESS_STATUSES } },
      select: { id: true },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) => row.id);
  }

  async sendForMonth(monthKey: string, options: { dryRun?: boolean } = {}): Promise<MonthSendSummary> {
    const summary: MonthSendSummary = { month: monthKey, considered: 0, sent: 0, skippedNoActivity: 0, skippedAlreadySent: 0, failed: 0, dryRun: Boolean(options.dryRun) };
    const trigger = `monthly_report:${monthKey}`;
    for (const userId of await this.eligibleStudentIds()) {
      summary.considered += 1;
      try {
        const already = await this.prisma.messageLog.findFirst({ where: { userId, trigger, status: 'sent' }, select: { id: true } });
        if (already) { summary.skippedAlreadySent += 1; continue; }
        const report = await this.build(userId, monthKey);
        if (!report.hasActivity) { summary.skippedNoActivity += 1; continue; }
        if (options.dryRun) { summary.sent += 1; continue; }
        const links = this.linksFor(userId, false);
        const result = await this.messaging.sendEmail(userId, { subject: report.subject, content: report.text, html: report.html, trigger, headers: { 'List-Unsubscribe': `<${links.unsubscribeUrl}>` } });
        if (result.ok) summary.sent += 1; else summary.failed += 1;
        await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
      } catch (error) {
        summary.failed += 1;
        this.logger.warn(`Relatorio mensal ${monthKey}: falha para uma aluna (${(error as Error).message}).`);
      }
    }
    this.logger.log(`Relatorio mensal ${monthKey}: ${summary.considered} considerada(s), ${summary.sent} ${summary.dryRun ? 'a enviar (simulacao)' : 'enviada(s)'}, ${summary.skippedNoActivity} sem treino, ${summary.skippedAlreadySent} ja enviada(s), ${summary.failed} falha(s).`);
    return summary;
  }

  // Teste pedido pelo treinador: os numeros de UMA aluna, enviados SO' para o e-mail do proprio treinador (nunca para a aluna). O link de descadastro do teste nao altera nada.
  async sendTestToCoach(coachUserId: string, studentId: string, monthKey: string) {
    const report = await this.build(studentId, monthKey, { preview: true });
    if (!report.hasActivity) throw new BadRequestException('Esta aluna não treinou nesse mês: o relatório real não seria enviado a ela. Escolha outro mês ou outra aluna.');
    const coach = await this.prisma.user.findUnique({ where: { id: coachUserId }, select: { email: true } });
    if (!coach) throw new NotFoundException('Treinador nao encontrado.');
    const result = await this.messaging.sendEmail(coachUserId, { subject: `[TESTE] ${report.subject}`, content: report.text, html: report.html, trigger: 'monthly_report_test' });
    if (!result.ok) throw new BadRequestException(`Não consegui enviar o e-mail de teste agora: ${result.error ?? 'erro desconhecido'}.`);
    return { sent: true, to: coach.email, month: monthKey, studentName: report.studentName };
  }

  async setOptOut(userId: string, optOut: boolean) {
    await this.prisma.user.update({ where: { id: userId }, data: { monthlyReportOptOut: optOut } });
  }

  verify(userId: string, token: string): boolean {
    return verifyOptOutToken(this.secret(), userId, token);
  }
}

// Envio automatico: dia 1, 9h (Sao Paulo). Desligado por padrao.
@Injectable()
export class MonthlyReportScheduler {
  private readonly logger = new Logger(MonthlyReportScheduler.name);
  private running = false;

  constructor(private readonly reports: MonthlyReportService, private readonly config: ConfigService) {}

  @Cron('0 9 1 * *', { timeZone: 'America/Sao_Paulo' })
  async runMonthly() {
    if (this.config.get<string>('MONTHLY_REPORT_ENABLED') !== 'true') {
      this.logger.log('Relatorio mensal: envio automatico desligado (MONTHLY_REPORT_ENABLED diferente de "true"); nada enviado.');
      return;
    }
    if (this.running) return;
    this.running = true;
    try {
      await this.reports.sendForMonth(previousMonthKey(new Date()));
    } catch (error) {
      this.logger.warn(`Relatorio mensal: falha geral (${(error as Error).message}).`);
    } finally {
      this.running = false;
    }
  }
}

const pageHtml = (title: string, body: string) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#F5F7FA;font:16px/1.5 Arial,sans-serif;color:#152033"><div style="max-width:480px;margin:48px auto;padding:32px;background:#fff;border-radius:16px;text-align:center"><div style="font:700 12px Arial;letter-spacing:1px;color:#1769AA">PANZERI RUN</div><h1 style="font-size:22px;margin:12px 0">${title}</h1>${body}</div></body></html>`;

// Sem login: o link do e-mail leva o id da aluna e um codigo assinado (HMAC). Codigo invalido nao revela nada.
@Controller('monthly-report')
export class MonthlyReportPublicController {
  constructor(private readonly reports: MonthlyReportService) {}

  @Get('unsubscribe')
  async unsubscribe(@Query('u') userId: string | undefined, @Query('t') token: string | undefined, @Query('on') on: string | undefined, @Query('preview') preview: string | undefined, @Res() response: { type: (value: string) => { send: (value: string) => void } }) {
    if (preview === '1') {
      response.type('html').send(pageHtml('Este é só um teste', '<p>No e-mail real, este link faz você parar de receber o relatório mensal. Neste e-mail de teste ele não altera nada.</p>'));
      return;
    }
    if (!userId || !token || !this.reports.verify(userId, token)) {
      response.type('html').send(pageHtml('Link inválido', '<p>Não foi possível confirmar este link. Se quiser parar de receber o relatório, fale com o seu treinador.</p>'));
      return;
    }
    const optOut = on !== '1';
    try {
      await this.reports.setOptOut(userId, optOut);
    } catch {
      response.type('html').send(pageHtml('Não deu certo agora', '<p>Tente de novo em alguns minutos.</p>'));
      return;
    }
    const link = `?u=${encodeURIComponent(userId)}&t=${encodeURIComponent(token)}&on=${optOut ? '1' : '0'}`;
    response.type('html').send(optOut
      ? pageHtml('Pronto, você não vai mais receber', `<p>O relatório mensal do Panzeri Run foi desligado para você. Seus treinos e avisos do aplicativo continuam normais.</p><p><a href="unsubscribe${link}" style="color:#1769AA">Mudei de ideia: quero receber de novo</a></p>`)
      : pageHtml('Combinado, você voltou a receber', `<p>O relatório mensal do Panzeri Run foi ligado de novo para você.</p><p><a href="unsubscribe${link}" style="color:#1769AA">Parar de receber</a></p>`));
  }
}

// Treinador/admin: previa e e-mail de teste para o PROPRIO e-mail (ficha da aluna).
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('coach', 'admin')
@Controller('coach/students')
export class MonthlyReportCoachController {
  constructor(private readonly reports: MonthlyReportService) {}

  private monthOrDefault(month: unknown): string {
    if (month === undefined || month === null || month === '') return previousMonthKey(new Date());
    if (!isMonthKey(month)) throw new BadRequestException('Informe o mês como AAAA-MM (exemplo: 2026-10).');
    return month;
  }

  @Get(':studentId/monthly-report/preview')
  async preview(@Param('studentId') studentId: string, @Query('month') month?: string) {
    const key = this.monthOrDefault(month);
    const report = await this.reports.build(studentId, key, { preview: true });
    return { month: key, hasActivity: report.hasActivity, subject: report.subject, html: report.html };
  }

  @Post(':studentId/monthly-report/test')
  test(@Param('studentId') studentId: string, @Body() body: { month?: string }, @CurrentUser() user: CurrentUserPayload) {
    return this.reports.sendTestToCoach(user.sub, studentId, this.monthOrDefault(body?.month));
  }
}
