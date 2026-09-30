import { BadGatewayException, BadRequestException, ConflictException, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';

const AUTHORIZATION_URL = 'https://flow.polar.com/oauth2/authorization';
const TOKEN_URL = 'https://polarremote.com/v2/oauth2/token';
const STATE_TTL_MS = 10 * 60 * 1000;

interface CallbackQuery {
  state?: unknown;
  code?: unknown;
  error?: unknown;
}

interface PolarTokenResponse {
  access_token?: unknown;
  token_type?: unknown;
  x_user_id?: unknown;
}

@Injectable()
export class PolarService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async connectUrl(userId: string) {
    const settings = this.settings();
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
    if (!user) throw new BadRequestException('Usuario nao encontrado.');

    // O state bruto so sai na URL de autorizacao. No banco fica seu hash, vinculado ao usuario.
    const state = randomBytes(32).toString('base64url');
    await this.prisma.polarOAuthAttempt.create({
      data: {
        stateHash: this.hashState(state),
        userId,
        expiresAt: new Date(Date.now() + STATE_TTL_MS),
      },
    });

    const url = new URL(AUTHORIZATION_URL);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: settings.clientId,
      redirect_uri: settings.redirectUri,
      scope: 'accesslink.read_all',
      state,
    }).toString();
    return { url: url.toString() };
  }

  async callback(query: CallbackQuery): Promise<'connected' | 'cancelled'> {
    const { state, code, error } = query;
    if (typeof state !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(state)) {
      throw new BadRequestException('Autorizacao Polar invalida ou expirada.');
    }
    const stateHash = this.hashState(state);
    const consumed = await this.prisma.polarOAuthAttempt.updateMany({
      where: { stateHash, consumedAt: null, expiresAt: { gt: new Date() } },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) throw new BadRequestException('Autorizacao Polar invalida ou ja utilizada.');

    const attempt = await this.prisma.polarOAuthAttempt.findUnique({
      where: { stateHash }, select: { userId: true },
    });
    if (!attempt) throw new BadRequestException('Autorizacao Polar invalida.');
    const user = await this.prisma.user.findUnique({ where: { id: attempt.userId }, select: { id: true } });
    if (!user) throw new BadRequestException('Usuario Panzeri Run nao encontrado.');

    if (error !== undefined) {
      if (typeof error !== 'string' || code !== undefined) throw new BadRequestException('Resposta Polar invalida.');
      if (error === 'access_denied') return 'cancelled';
      throw new BadRequestException('A Polar nao concluiu a autorizacao.');
    }
    if (typeof code !== 'string' || !code || code.length > 2048) {
      throw new BadRequestException('Codigo de autorizacao Polar ausente ou invalido.');
    }

    // O code Polar e de uso unico: nunca repetir a troca, inclusive apos erro de rede.
    const settings = this.settings();
    const token = await this.exchangeCode(code, settings);
    const owner = await this.prisma.polarConnection.findUnique({
      where: { polarUserId: token.polarUserId }, select: { userId: true },
    });
    if (owner && owner.userId !== user.id) {
      throw new ConflictException('Esta conta Polar ja esta vinculada a outro usuario.');
    }
    const accessTokenEncrypted = this.encrypt(token.accessToken, settings.key);
    await this.prisma.polarConnection.upsert({
      where: { userId: user.id },
      create: { userId: user.id, polarUserId: token.polarUserId, accessTokenEncrypted },
      update: { polarUserId: token.polarUserId, accessTokenEncrypted },
    });
    return 'connected';
  }

  private settings() {
    const clientId = this.config.get<string>('POLAR_CLIENT_ID')?.trim();
    const clientSecret = this.config.get<string>('POLAR_CLIENT_SECRET')?.trim();
    const redirectUri = this.config.get<string>('POLAR_REDIRECT_URI')?.trim();
    const rawKey = this.config.get<string>('POLAR_TOKEN_ENCRYPTION_KEY')?.trim();
    if (!clientId || !clientSecret || !redirectUri || !rawKey || !/^[\da-fA-F]{64}$/.test(rawKey)) {
      throw new ServiceUnavailableException('Polar ainda nao configurada no servidor.');
    }
    let redirect: URL;
    try { redirect = new URL(redirectUri); }
    catch { throw new ServiceUnavailableException('Redirect Polar invalido no servidor.'); }
    if (redirect.protocol !== 'https:' || redirect.pathname !== '/polar/callback' || redirect.search || redirect.hash || redirect.username || redirect.password) {
      throw new ServiceUnavailableException('Redirect Polar invalido no servidor.');
    }
    return { clientId, clientSecret, redirectUri, key: Buffer.from(rawKey, 'hex') };
  }

  private async exchangeCode(code: string, settings: ReturnType<PolarService['settings']>) {
    let response: Response;
    try {
      response = await fetch(TOKEN_URL, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${Buffer.from(`${settings.clientId}:${settings.clientSecret}`).toString('base64')}`,
          'Content-Type': 'application/x-www-form-urlencoded',
          Accept: 'application/json',
        },
        body: new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: settings.redirectUri }),
      });
    } catch {
      throw new BadGatewayException('Nao foi possivel contatar a Polar. Inicie outra conexao.');
    }
    if (!response.ok) throw new BadGatewayException('A Polar recusou a autorizacao. Inicie outra conexao.');
    let payload: PolarTokenResponse;
    try { payload = await response.json() as PolarTokenResponse; }
    catch { throw new BadGatewayException('Resposta de autorizacao Polar invalida.'); }
    const polarUserId = payload.x_user_id;
    if (typeof payload.access_token !== 'string' || !payload.access_token ||
        payload.token_type !== 'bearer' ||
        !(typeof polarUserId === 'string' && /^\d+$/.test(polarUserId) || typeof polarUserId === 'number' && Number.isSafeInteger(polarUserId))) {
      throw new BadGatewayException('Resposta de autorizacao Polar invalida.');
    }
    return { accessToken: payload.access_token, polarUserId: String(polarUserId) };
  }

  private hashState(state: string) {
    return createHash('sha256').update(state).digest('hex');
  }

  private encrypt(value: string, key: Buffer) {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
    return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
  }
}