import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

// Codigo sequencial de 7 digitos (User.studentCode) formatado com zeros a esquerda pra exibicao —
// usado em toda mensagem de Telegram e no painel do treinador, pra identificar o aluno sem
// ambiguidade de nome (dois alunos podem se chamar igual; o codigo nunca se repete).
export function formatStudentCode(code: number | null | undefined): string {
  if (code == null) return 'Sem codigo (prospecto)';
  return String(code).padStart(7, '0');
}

@Injectable()
export class TelegramService {
  private readonly logger = new Logger(TelegramService.name);

  constructor(private readonly config: ConfigService) {}

  async notifyCoach(text: string) {
    const token = this.config.get<string>('TELEGRAM_BOT_TOKEN');
    const chatId = this.config.get<string>('TELEGRAM_CHAT_ID');
    if (!token || !chatId) return;

    try {
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ chat_id: chatId, text }),
      });
      if (!response.ok) {
        this.logger.warn(`Falha ao enviar mensagem no Telegram: ${response.status}`);
      }
    } catch (error) {
      this.logger.warn(`Erro ao enviar mensagem no Telegram: ${(error as Error).message}`);
    }
  }
}
