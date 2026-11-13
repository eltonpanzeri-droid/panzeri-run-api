import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { TelegramService, formatStudentCode } from '../billing/telegram.service';
import { jpegDimensions } from '../profile-photo/profile-photo.service';

// "Relatar problema" (13/11/2026). A aluna manda o relato; o treinador e' avisado no Telegram e acompanha no painel. Nenhuma IA, nenhuma regra de treino.
export const PROBLEM_TYPES = ['error', 'usability', 'wrong_data', 'suggestion'] as const;
export type ProblemType = (typeof PROBLEM_TYPES)[number];
export const PROBLEM_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export const PROBLEM_TYPE_LABELS: Record<ProblemType, string> = { error: 'Erro', usability: 'Dificuldade de utilização', wrong_data: 'Dados incorretos', suggestion: 'Sugestão' };
export const PROBLEM_MESSAGE_MAX = 2000;
export const PROBLEM_MESSAGE_MIN = 5;
export const PROBLEM_MAX_IMAGES = 3;
export const PROBLEM_MAX_PER_DAY = 10;
// Cada imagem vai numa requisicao propria (limite padrao de 100 KB de JSON): 70 KB de JPEG viram ~93 KB em base64. O app reduz e comprime antes de enviar.
export const PROBLEM_IMAGE_MAX_BYTES = 70 * 1024;
const IMAGE_UPLOAD_WINDOW_MS = 30 * 60 * 1000;

const clean = (value: unknown, max: number): string | null => {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
  return text === '' ? null : text;
};

export function decodeProblemImage(imageBase64: unknown): Buffer {
  if (typeof imageBase64 !== 'string' || imageBase64.length === 0) throw new BadRequestException('Envie a imagem.');
  const base64 = imageBase64.replace(/^data:image\/jpeg;base64,/, '');
  if (base64.length > Math.ceil((PROBLEM_IMAGE_MAX_BYTES * 4) / 3) + 8 || !/^[A-Za-z0-9+/]+={0,2}$/.test(base64)) throw new BadRequestException('Imagem inválida ou grande demais.');
  const buffer = Buffer.from(base64, 'base64');
  if (buffer.length > PROBLEM_IMAGE_MAX_BYTES) throw new BadRequestException('A imagem precisa ter no máximo 70 KB depois de reduzida.');
  if (!jpegDimensions(buffer)) throw new BadRequestException('A imagem precisa ser JPEG.');
  return buffer;
}

@Injectable()
export class ProblemReportsService {
  constructor(private readonly prisma: PrismaService, private readonly telegram: TelegramService) {}

  async create(userId: string, body: { type?: unknown; message?: unknown; appVersion?: unknown; platform?: unknown; osVersion?: unknown; deviceModel?: unknown; expectedImages?: unknown }) {
    if (!(PROBLEM_TYPES as readonly string[]).includes(body?.type as string)) throw new BadRequestException('Escolha o tipo do problema.');
    const message = typeof body?.message === 'string' ? body.message.trim() : '';
    if (message.length < PROBLEM_MESSAGE_MIN) throw new BadRequestException('Descreva o que aconteceu.');
    if (message.length > PROBLEM_MESSAGE_MAX) throw new BadRequestException(`A descrição pode ter no máximo ${PROBLEM_MESSAGE_MAX} caracteres.`);
    const since = new Date(Date.now() - 24 * 3600 * 1000);
    if ((await this.prisma.problemReport.count({ where: { userId, createdAt: { gte: since } } })) >= PROBLEM_MAX_PER_DAY) throw new ForbiddenException('Você já enviou muitos relatos hoje. Tente de novo amanhã.');

    const report = await this.prisma.problemReport.create({
      data: {
        userId,
        type: body.type as ProblemType,
        message,
        appVersion: clean(body.appVersion, 32),
        platform: clean(body.platform, 16),
        osVersion: clean(body.osVersion, 32),
        deviceModel: clean(body.deviceModel, 64),
      },
      select: { id: true, type: true, message: true, appVersion: true, platform: true, osVersion: true, deviceModel: true, createdAt: true, user: { select: { name: true, studentCode: true } } },
    });
    const expected = Math.min(PROBLEM_MAX_IMAGES, Math.max(0, Number(body?.expectedImages) || 0));
    const text = [
      `🛠️ Relato de problema — ${PROBLEM_TYPE_LABELS[report.type as ProblemType]}`,
      `👤 ${report.user.name ?? 'desconhecido'} (Cod. ${formatStudentCode(report.user.studentCode)})`,
      `📱 ${[report.platform, report.osVersion, report.deviceModel].filter(Boolean).join(' · ') || 'aparelho não informado'} · app ${report.appVersion ?? '?'}`,
      '',
      report.message.length > 900 ? `${report.message.slice(0, 900)}…` : report.message,
      expected > 0 ? `\n🖼️ ${expected} imagem(ns) anexada(s): ver no painel.` : '',
    ].join('\n');
    // O aviso e' melhor esforco: o relato ja' esta gravado; falha do Telegram nunca perde o relato.
    await this.telegram.notifyCoach(text).catch(() => undefined);
    return { id: report.id };
  }

  async addImage(userId: string, reportId: string, imageBase64: unknown) {
    const report = await this.prisma.problemReport.findFirst({ where: { id: reportId, userId }, select: { id: true, createdAt: true } });
    if (!report) throw new NotFoundException('Relato não encontrado.');
    if (Date.now() - report.createdAt.getTime() > IMAGE_UPLOAD_WINDOW_MS) throw new ForbiddenException('O prazo para anexar imagens a este relato terminou.');
    const buffer = decodeProblemImage(imageBase64);
    if ((await this.prisma.problemReportImage.count({ where: { reportId } })) >= PROBLEM_MAX_IMAGES) throw new BadRequestException(`No máximo ${PROBLEM_MAX_IMAGES} imagens por relato.`);
    const row = await this.prisma.problemReportImage.create({ data: { reportId, data: buffer, mimeType: 'image/jpeg', byteSize: buffer.length }, select: { id: true } });
    return { id: row.id };
  }

  // A aluna ve os proprios relatos (sem imagens) e o andamento.
  async listMine(userId: string) {
    const rows = await this.prisma.problemReport.findMany({ where: { userId }, orderBy: { createdAt: 'desc' }, take: 30, select: { id: true, type: true, message: true, status: true, createdAt: true, resolvedAt: true } });
    return rows.map((row) => ({ ...row, typeLabel: PROBLEM_TYPE_LABELS[row.type as ProblemType] ?? row.type }));
  }

  // ---- treinador/admin ----
  async listForCoach(status?: string) {
    const where = status && (PROBLEM_STATUSES as readonly string[]).includes(status) ? { status } : {};
    const rows = await this.prisma.problemReport.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 200,
      select: {
        id: true, type: true, message: true, appVersion: true, platform: true, osVersion: true, deviceModel: true, status: true, coachNote: true, createdAt: true, resolvedAt: true,
        user: { select: { id: true, name: true, studentCode: true } },
        images: { select: { id: true, byteSize: true }, orderBy: { createdAt: 'asc' } },
      },
    });
    return rows.map((row) => ({ ...row, typeLabel: PROBLEM_TYPE_LABELS[row.type as ProblemType] ?? row.type, studentCode: formatStudentCode(row.user.studentCode) }));
  }

  async imageForCoach(reportId: string, imageId: string) {
    const row = await this.prisma.problemReportImage.findFirst({ where: { id: imageId, reportId }, select: { data: true, mimeType: true } });
    if (!row) throw new NotFoundException('Imagem não encontrada.');
    return { dataUri: `data:${row.mimeType};base64,${Buffer.from(row.data).toString('base64')}` };
  }

  async updateForCoach(reportId: string, body: { status?: unknown; coachNote?: unknown }) {
    const data: { status?: string; coachNote?: string | null; resolvedAt?: Date | null } = {};
    if (body?.status !== undefined) {
      if (!(PROBLEM_STATUSES as readonly string[]).includes(body.status as string)) throw new BadRequestException('Situação inválida.');
      data.status = body.status as string;
      data.resolvedAt = body.status === 'resolved' ? new Date() : null;
    }
    if (body?.coachNote !== undefined) data.coachNote = clean(body.coachNote, 1000);
    if (Object.keys(data).length === 0) throw new BadRequestException('Nada para atualizar.');
    const updated = await this.prisma.problemReport.updateMany({ where: { id: reportId }, data });
    if (updated.count !== 1) throw new NotFoundException('Relato não encontrado.');
    return { ok: true };
  }
}
