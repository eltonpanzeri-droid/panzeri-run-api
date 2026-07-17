import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
  private readonly client: Resend | null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    this.client = apiKey ? new Resend(apiKey) : null;
    this.fromAddress = this.config.get<string>('RESEND_FROM_EMAIL') ?? 'Panzeri Run <onboarding@resend.dev>';
  }

  async send(to: string, subject: string, text: string): Promise<{ ok: boolean; error?: string }> {
    if (!this.client) {
      this.logger.warn('RESEND_API_KEY nao configurado - e-mail nao enviado.');
      return { ok: false, error: 'Servico de e-mail nao configurado.' };
    }

    try {
      const result = await this.client.emails.send({
        from: this.fromAddress,
        to,
        subject,
        text,
      });

      if (result.error) {
        this.logger.warn(`Falha ao enviar e-mail: ${result.error.message}`);
        return { ok: false, error: result.error.message };
      }

      return { ok: true };
    } catch (error) {
      this.logger.warn(`Erro ao enviar e-mail: ${(error as Error).message}`);
      return { ok: false, error: (error as Error).message };
    }
  }
}
