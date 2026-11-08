import { readFileSync } from 'fs';
import { join } from 'path';
import { BadRequestException } from '@nestjs/common';
import { buildNativeInviteEmail, isInviteRecipient, NativeInviteService, nativeInviteLinks, NATIVE_INVITE_TRIGGER } from '../src/equipment/native-invite.service';
import { detectInvitePlatform, nativeInviteStores, NATIVE_INVITE_REPEAT_MS, shouldShowNativeInvite } from '../../mobile/src/nativeInvite/nativeInviteLogic';

// 08/11/2026 — convite para baixar o Panzeri Run nas lojas (pedido de Elton). Envio em massa: so' por acao explicita, uma vez por aluna, teste so' para quem pede.
const links = nativeInviteLinks('https://api.exemplo.com/');

describe('quem recebe o convite', () => {
  it('so alunas ATUAIS que parecem usar o navegador', () => {
    expect(isInviteRecipient({ access: 'browser_probable', paymentGroup: 'confirmed' })).toBe(true);
    expect(isInviteRecipient({ access: 'browser_probable', paymentGroup: 'courtesy' })).toBe(true);
    expect(isInviteRecipient({ access: 'browser_probable', paymentGroup: 'overdue' })).toBe(true);
    expect(isInviteRecipient({ access: 'browser_probable', paymentGroup: 'canceled' })).toBe(false); // ex-aluna
    expect(isInviteRecipient({ access: 'browser_probable', paymentGroup: 'pending' })).toBe(false); // prospecto nao e aluna
    expect(isInviteRecipient({ access: 'android', paymentGroup: 'confirmed' })).toBe(false);
    expect(isInviteRecipient({ access: 'ios', paymentGroup: 'confirmed' })).toBe(false);
    expect(isInviteRecipient({ access: 'native_unknown', paymentGroup: 'confirmed' })).toBe(false);
  });
});

describe('texto do e-mail', () => {
  const email = buildNativeInviteEmail('Maria da Silva', links);
  it('chama pelo primeiro nome, traz os dois links e as vantagens pedidas', () => {
    expect(email.content).toContain('Olá, Maria!');
    expect(email.content).toContain('https://api.exemplo.com/ir/apple?');
    expect(email.content).toContain('https://api.exemplo.com/ir/play?');
    expect(email.content).toContain('Atualizações automáticas');
    expect(email.content).toContain('Apple Saúde');
    expect(email.content).toContain('Health Connect');
    expect(email.content).toContain('mesmo e-mail e a mesma senha');
  });
  it('respeita a linguagem do projeto: sem "app" e sem "plano de treino"', () => {
    expect(email.subject + email.content).not.toMatch(/\bapp\b(?! Store)/i); // "App Store" é o nome da loja
    expect(email.content).not.toMatch(/plano de treino/i);
    expect(email.content).toContain('programa de treino');
  });
  it('nao promete o envio de treino ao Apple Watch (so chega no proximo build)', () => {
    expect(email.content).not.toMatch(/enviar.{0,30}Apple Watch|treino.{0,30}ao relógio/i);
  });
  it('sem nome, nao quebra', () => {
    expect(buildNativeInviteEmail(null, links).content.startsWith('Olá!')).toBe(true);
  });
});

describe('NativeInviteService.sendAll', () => {
  function build(overrides: { alreadySent?: string[]; sendOk?: boolean } = {}) {
    const rows = [
      { id: 'u1', studentCode: 1, name: 'Ana Souza', access: 'browser_probable', paymentGroup: 'confirmed' },
      { id: 'u2', studentCode: 2, name: 'Bia Lima', access: 'browser_probable', paymentGroup: 'courtesy' },
      { id: 'u3', studentCode: 3, name: 'Carla', access: 'android', paymentGroup: 'confirmed' },
    ];
    const sentLogs = (overrides.alreadySent ?? []).map((userId) => ({ userId }));
    const prisma: any = {
      user: { findMany: jest.fn(async () => [{ id: 'u1', email: 'ana@x.com' }, { id: 'u2', email: 'bia@x.com' }]), findUnique: jest.fn(async () => ({ email: 'elton@x.com', name: 'Elton' })) },
      messageLog: { findMany: jest.fn(async () => sentLogs) },
    };
    const messaging: any = {
      hasEverSentTrigger: jest.fn(async (id: string) => (overrides.alreadySent ?? []).includes(id)),
      sendEmail: jest.fn(async () => (overrides.sendOk === false ? { ok: false, error: 'falhou' } : { ok: true })),
    };
    const email: any = { send: jest.fn(async () => ({ ok: true })) };
    const notifications: any = { notifyUserIfNotRecent: jest.fn(async () => true) };
    const access: any = { run: jest.fn(async () => ({ rows })) };
    return { service: new NativeInviteService(prisma, access, messaging, email, notifications), messaging, email, notifications };
  }

  it('recusa quando a contagem confirmada nao bate (lista mudou)', async () => {
    const { service, messaging } = build();
    await expect(service.sendAll(5)).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.sendAll(NaN)).rejects.toBeInstanceOf(BadRequestException);
    expect(messaging.sendEmail).not.toHaveBeenCalled();
  });

  it('envia e-mail + aviso no sino para cada aluna elegivel, e so para elas', async () => {
    const { service, messaging, notifications } = build();
    const result = await service.sendAll(2);
    expect(result).toEqual({ sent: 2, failed: [] });
    expect(messaging.sendEmail).toHaveBeenCalledTimes(2);
    expect(messaging.sendEmail.mock.calls.map((c: any[]) => c[0])).toEqual(['u1', 'u2']);
    expect(messaging.sendEmail.mock.calls[0][1].trigger).toBe(NATIVE_INVITE_TRIGGER);
    expect(notifications.notifyUserIfNotRecent).toHaveBeenCalledTimes(2);
    expect(notifications.notifyUserIfNotRecent.mock.calls[0][1].externalRef).toBe('native_app_invite_v1');
  });

  it('quem ja recebeu nao recebe de novo (idempotente)', async () => {
    const { service, messaging } = build({ alreadySent: ['u1'] });
    const preview = await service.preview();
    expect(preview.toSend).toBe(1);
    expect(preview.alreadySent).toBe(1);
    await expect(service.sendAll(2)).rejects.toBeInstanceOf(BadRequestException);
    expect(await service.sendAll(1)).toEqual({ sent: 1, failed: [] });
    expect(messaging.sendEmail).toHaveBeenCalledTimes(1);
  });

  it('falha de e-mail e relatada e NAO gera aviso no sino', async () => {
    const { service, notifications } = build({ sendOk: false });
    const result = await service.sendAll(2);
    expect(result.sent).toBe(0);
    expect(result.failed).toHaveLength(2);
    expect(notifications.notifyUserIfNotRecent).not.toHaveBeenCalled();
  });

  it('a previa nao expoe e-mail de aluna', async () => {
    const { service } = build();
    const preview = await service.preview();
    expect(JSON.stringify(preview.recipients)).not.toMatch(/@/);
  });

  it('o teste vai SO para o e-mail de quem pediu', async () => {
    const { service, email, messaging } = build();
    const result = await service.sendTest('coach-id');
    expect(result.sentTo).toBe('elton@x.com');
    expect(email.send).toHaveBeenCalledTimes(1);
    expect(email.send.mock.calls[0][0]).toBe('elton@x.com');
    expect(email.send.mock.calls[0][1]).toMatch(/^\[TESTE\]/);
    expect(messaging.sendEmail).not.toHaveBeenCalled();
  });
});

describe('aviso no PWA (parte pura)', () => {
  it('detecta o celular e mostra a loja certa', () => {
    expect(detectInvitePlatform('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')).toBe('ios');
    expect(detectInvitePlatform('Mozilla/5.0 (Linux; Android 14; SM-S918B)')).toBe('android');
    expect(nativeInviteStores('/api', 'ios').map((s) => s.key)).toEqual(['apple']);
    expect(nativeInviteStores('/api', 'android').map((s) => s.key)).toEqual(['play']);
    expect(nativeInviteStores('/api', 'other').map((s) => s.key)).toEqual(['apple', 'play']);
    expect(nativeInviteStores('/api', 'ios')[0].url.startsWith('/api/ir/apple?')).toBe(true);
  });
  it('volta a aparecer so depois de 7 dias', () => {
    const now = Date.UTC(2026, 10, 8);
    expect(shouldShowNativeInvite(null, now)).toBe(true);
    expect(shouldShowNativeInvite(now - 1000, now)).toBe(false);
    expect(shouldShowNativeInvite(now - NATIVE_INVITE_REPEAT_MS, now)).toBe(true);
    expect(shouldShowNativeInvite(NaN, now)).toBe(true);
  });
  it('o aviso so existe no navegador/PWA e esta ligado no inicio', () => {
    const card = readFileSync(join(__dirname, '..', '..', 'mobile', 'src', 'nativeInvite', 'NativeInviteCard.tsx'), 'utf8');
    const app = readFileSync(join(__dirname, '..', '..', 'mobile', 'App.tsx'), 'utf8');
    expect(card).toContain("Platform.OS !== 'web'");
    expect(app).toContain('<NativeInviteCard apiUrl={API_URL} />');
  });
});
