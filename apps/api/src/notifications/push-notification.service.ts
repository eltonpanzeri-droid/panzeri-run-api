import { Injectable, Logger } from '@nestjs/common';

// Chama direto a API HTTP publica do Expo (https://exp.host/--/api/v2/push/send) — mesmo padrao
// "raw fetch" do TelegramService (../billing/telegram.service.ts), sem SDK adicional. So funciona
// pra tokens que comecam com "ExponentPushToken[" (formato do Expo); qualquer outra coisa e
// ignorada silenciosamente (defesa contra token corrompido/antigo salvo no banco).
@Injectable()
export class PushNotificationService {
  private readonly logger = new Logger(PushNotificationService.name);

  async send(expoPushToken: string | null | undefined, title: string, body: string) {
    if (!expoPushToken || !expoPushToken.startsWith('ExponentPushToken')) return;

    try {
      const response = await fetch('https://exp.host/--/api/v2/push/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({
          to: expoPushToken,
          title,
          body,
          sound: 'default',
          priority: 'high',
        }),
      });
      if (!response.ok) {
        this.logger.warn(`Falha ao enviar push notification: ${response.status}`);
        return;
      }
      const payload = await response.json().catch(() => null);
      // O Expo responde 200 mesmo quando o token e invalido/desregistrado — o erro real vem
      // dentro de data.status. So logamos (nunca lancamos) pra nao quebrar quem chamou isso.
      const status = payload?.data?.status;
      if (status && status !== 'ok') {
        this.logger.warn(`Push notification recusada pelo Expo: ${JSON.stringify(payload.data)}`);
      }
    } catch (error) {
      this.logger.warn(`Erro ao enviar push notification: ${(error as Error).message}`);
    }
  }
}
