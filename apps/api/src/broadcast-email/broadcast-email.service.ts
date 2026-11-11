import { BadRequestException, ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MessagingService } from '../messaging/messaging.service';

// Comunicado por e-mail para todas as alunas (11/11/2026, pedido de Elton: avisar da versao 1.0.4).
// Quem recebe: aluna com acesso (mesmos status do relatorio mensal), conta ativa, nunca conta de teste. Prospecto, ex-aluna e teste ficam de fora.
// Seguranca: (1) so' o treinador/admin chama (guard no controlador); (2) o envio exige a CONFIRMACAO da contagem exata mostrada na tela; (3) idempotente por "chave" do comunicado
// (trigger broadcast:<chave> no MessageLog — quem ja recebeu nao recebe de novo, mesmo se clicar duas vezes ou reiniciar); (4) roda em segundo plano com pausa entre envios
// (limite da Resend) e uma trava para nao haver dois envios ao mesmo tempo. Nenhuma IA, nenhuma regra de treino.
export const BROADCAST_ACCESS_STATUSES = ['active', 'manual_active', 'grace'];
const SEND_GAP_MS = 700;
export const BROADCAST_KEY_PATTERN = /^[a-z0-9][a-z0-9-]{2,59}$/;

export interface BroadcastInput { key: string; subject: string; message: string }
export interface BroadcastStatus { key: string; eligible: number; alreadySent: number; failed: number; pending: number; running: boolean }

export function firstNameOf(name: string | null | undefined): string {
  return (name ?? '').trim().split(/\s+/)[0] ?? '';
}

// {nome} vira o primeiro nome da aluna; sem nome cadastrado, a saudacao some junto ("Olá, {nome}!" -> "Olá!").
export function personalize(message: string, name: string | null | undefined): string {
  const first = firstNameOf(name);
  const withName = message.replace(/\{nome\}/gi, first);
  return first ? withName : withName.replace(/,\s*(?=[!.,])/g, '').replace(/ {2,}/g, ' ');
}

@Injectable()
export class BroadcastEmailService {
  private readonly logger = new Logger(BroadcastEmailService.name);
  private running: string | null = null;

  constructor(private readonly prisma: PrismaService, private readonly messaging: MessagingService) {}

  private validate(input: BroadcastInput) {
    if (!BROADCAST_KEY_PATTERN.test(input.key ?? '')) throw new BadRequestException('A chave do comunicado deve ter 3 a 60 caracteres: letras minúsculas, números e hífen (exemplo: versao-1-0-4).');
    if (!input.subject?.trim() || input.subject.length > 150) throw new BadRequestException('Informe o assunto (até 150 caracteres).');
    if (!input.message?.trim() || input.message.length > 5000) throw new BadRequestException('Informe a mensagem (até 5000 caracteres).');
  }

  private trigger(key: string) {
    return `broadcast:${key}`;
  }

  private async eligible(): Promise<Array<{ id: string; name: string | null }>> {
    return this.prisma.user.findMany({
      where: { role: 'student', accountStatus: 'active', isTestAccount: false, subscriptionStatus: { in: BROADCAST_ACCESS_STATUSES } },
      select: { id: true, name: true },
      orderBy: { createdAt: 'asc' },
    });
  }

  async status(key: string): Promise<BroadcastStatus> {
    if (!BROADCAST_KEY_PATTERN.test(key ?? '')) throw new BadRequestException('Chave do comunicado inválida.');
    const students = await this.eligible();
    const ids = students.map((student) => student.id);
    const logs = await this.prisma.messageLog.findMany({ where: { trigger: this.trigger(key), userId: { in: ids } }, select: { userId: true, status: true } });
    const sent = new Set(logs.filter((log) => log.status === 'sent').map((log) => log.userId));
    const failed = new Set(logs.filter((log) => log.status !== 'sent' && !sent.has(log.userId)).map((log) => log.userId));
    return { key, eligible: ids.length, alreadySent: sent.size, failed: failed.size, pending: ids.length - sent.size, running: this.running === key };
  }

  // Pre-visualizacao: quantas alunas receberiam e como fica o texto com o nome da primeira. NAO envia nada.
  async preview(input: BroadcastInput) {
    this.validate(input);
    const status = await this.status(input.key);
    const students = await this.eligible();
    const sample = students[0];
    return { ...status, sampleText: personalize(input.message, sample?.name), sampleName: firstNameOf(sample?.name) };
  }

  // Teste: UMA copia, so' para o e-mail do proprio treinador.
  async sendTestToCoach(coachUserId: string, input: BroadcastInput) {
    this.validate(input);
    const result = await this.messaging.sendEmail(coachUserId, { subject: `[TESTE] ${input.subject.trim()}`, content: personalize(input.message, 'Elton'), trigger: 'broadcast_test' });
    if (!result.ok) throw new BadRequestException(`Não consegui enviar o teste agora: ${result.error ?? 'erro desconhecido'}.`);
    return { sent: true };
  }

  // Inicia o envio em segundo plano. confirmCount precisa ser igual ao numero de alunas AINDA sem o comunicado (o que a tela mostrou).
  async start(input: BroadcastInput, confirmCount: number) {
    this.validate(input);
    if (this.running) throw new ConflictException(`Já existe um envio em andamento (${this.running}). Aguarde terminar.`);
    const before = await this.status(input.key);
    if (before.pending === 0) throw new BadRequestException('Todas as alunas já receberam este comunicado.');
    if (confirmCount !== before.pending) throw new BadRequestException(`A contagem mudou (agora são ${before.pending} alunas a receber). Confira a tela e confirme de novo.`);
    this.running = input.key;
    void this.run(input).finally(() => { this.running = null; });
    return { started: true, total: before.pending };
  }

  private async run(input: BroadcastInput) {
    const trigger = this.trigger(input.key);
    let sent = 0;
    let failed = 0;
    try {
      for (const student of await this.eligible()) {
        try {
          const already = await this.prisma.messageLog.findFirst({ where: { userId: student.id, trigger, status: 'sent' }, select: { id: true } });
          if (already) continue;
          const result = await this.messaging.sendEmail(student.id, { subject: input.subject.trim(), content: personalize(input.message, student.name), trigger });
          if (result.ok) sent += 1; else failed += 1;
        } catch (error) {
          failed += 1;
          this.logger.warn(`Comunicado ${input.key}: falha para uma aluna (${(error as Error).message}).`);
        }
        await new Promise((resolve) => setTimeout(resolve, SEND_GAP_MS));
      }
    } catch (error) {
      this.logger.warn(`Comunicado ${input.key}: falha geral (${(error as Error).message}).`);
    }
    this.logger.log(`Comunicado ${input.key}: ${sent} enviada(s), ${failed} falha(s).`);
  }

  async coachExists(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: { id: true } });
    if (!user) throw new NotFoundException('Treinador não encontrado.');
  }
}
