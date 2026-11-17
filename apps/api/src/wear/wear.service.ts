import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { hasSubscriptionAccess, todayInSaoPaulo } from '../training-plans/training-plans.service';
import {
  displayPairingCode, generatePairingCode, generateSecret, hashSecret, MAX_ACTIVE_WEAR_DEVICES, normalizePairingCode, PAIRING_TTL_MS, secretsMatch,
} from './wear-pairing';
import { wearSessionsOf, type WearSession } from './wear-week';

// Relogio Wear OS (fase 1, 17/11/2026): pareamento por codigo + treino da semana SOMENTE para leitura. A credencial do relogio so' le os treinos da propria aluna; nao grava nada, nao le saude
// nem localizacao. A aluna ve e retira cada relogio no Panzeri Run; retirar invalida a credencial na hora.

const LAST_SEEN_MIN_INTERVAL_MS = 5 * 60_000;
// janela dos treinos enviados ao relogio: de ontem ate' 14 dias a frente (a semana atual e a seguinte, ja' gerada no domingo)
const WEEK_BACK_DAYS = 1;
const WEEK_AHEAD_DAYS = 14;

export type PollResult = { status: 'pending' } | { status: 'expired' } | { status: 'revoked' } | { status: 'already_issued' } | { status: 'paired'; token: string };

@Injectable()
export class WearService {
  private readonly logger = new Logger(WearService.name);

  constructor(private readonly prisma: PrismaService) {}

  // O relogio pede um codigo. Nenhum dado de aluna existe ainda: so' o nome do aparelho (texto curto, sem identificadores).
  async startPairing(deviceName: unknown, now: Date = new Date()): Promise<{ pairingId: string; code: string; pollSecret: string; expiresAt: string }> {
    const name = typeof deviceName === 'string' ? deviceName.replace(/\s+/g, ' ').trim().slice(0, 60) : '';
    // limpeza oportunista: pareamentos nunca confirmados e vencidos ha mais de um dia
    await this.prisma.wearDevice.deleteMany({ where: { userId: null, pairingExpiresAt: { lt: new Date(now.getTime() - 86_400_000) } } }).catch(() => undefined);
    const pollSecret = generateSecret();
    const expiresAt = new Date(now.getTime() + PAIRING_TTL_MS);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const code = generatePairingCode();
      try {
        const row = await this.prisma.wearDevice.create({
          data: { deviceName: name || null, pairingCodeHash: hashSecret(code), pollSecretHash: hashSecret(pollSecret), pairingExpiresAt: expiresAt },
          select: { id: true },
        });
        return { pairingId: row.id, code: displayPairingCode(code), pollSecret, expiresAt: expiresAt.toISOString() };
      } catch (error) {
        if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002') throw error; // colisao de codigo: sorteia outro
      }
    }
    throw new BadRequestException('Nao foi possivel gerar um codigo agora. Tente de novo.');
  }

  // A aluna (logada) confirma o codigo que apareceu no relogio. Mensagem unica para codigo errado, vencido ou ja' usado (nao ajuda a adivinhar).
  async confirmPairing(userId: string, codeInput: unknown, now: Date = new Date()): Promise<{ deviceId: string; deviceName: string | null }> {
    const invalid = () => new NotFoundException({ code: 'wear_code_invalid', message: 'Código inválido ou vencido. Confira o código no relógio ou peça um novo.' });
    const code = normalizePairingCode(codeInput);
    if (!code) throw invalid();
    const active = await this.prisma.wearDevice.count({ where: { userId, revokedAt: null, confirmedAt: { not: null } } });
    if (active >= MAX_ACTIVE_WEAR_DEVICES) throw new BadRequestException({ code: 'wear_too_many_devices', message: `Você já tem ${MAX_ACTIVE_WEAR_DEVICES} relógios conectados. Retire um antes de conectar outro.` });
    const row = await this.prisma.wearDevice.findUnique({ where: { pairingCodeHash: hashSecret(code) }, select: { id: true, userId: true, confirmedAt: true, revokedAt: true, pairingExpiresAt: true, deviceName: true } });
    if (!row || row.userId || row.confirmedAt || row.revokedAt || !row.pairingExpiresAt || row.pairingExpiresAt.getTime() < now.getTime()) throw invalid();
    // so' confirma se ninguem confirmou nesse meio tempo (condicao no proprio UPDATE)
    const updated = await this.prisma.wearDevice.updateMany({ where: { id: row.id, userId: null, confirmedAt: null, revokedAt: null }, data: { userId, confirmedAt: now, pairingCodeHash: null } });
    if (updated.count !== 1) throw invalid();
    this.logger.log(`Relogio Wear OS pareado (aluna ${userId}, aparelho ${row.id}).`);
    return { deviceId: row.id, deviceName: row.deviceName };
  }

  // O relogio pergunta se ja' foi confirmado. A credencial sai UMA vez; depois disso so' "ja emitida".
  async pollPairing(pairingId: unknown, pollSecret: unknown, now: Date = new Date()): Promise<PollResult> {
    if (typeof pairingId !== 'string' || typeof pollSecret !== 'string') throw new UnauthorizedException();
    const row = await this.prisma.wearDevice.findUnique({ where: { id: pairingId }, select: { id: true, pollSecretHash: true, confirmedAt: true, revokedAt: true, tokenHash: true, pairingExpiresAt: true } });
    if (!row || !secretsMatch(pollSecret, row.pollSecretHash)) throw new UnauthorizedException();
    if (row.revokedAt) return { status: 'revoked' };
    if (!row.confirmedAt) return row.pairingExpiresAt && row.pairingExpiresAt.getTime() < now.getTime() ? { status: 'expired' } : { status: 'pending' };
    if (row.tokenHash) return { status: 'already_issued' };
    const token = generateSecret();
    // a emissao e' atomica: se duas consultas chegarem juntas, so' uma recebe a credencial
    const issued = await this.prisma.wearDevice.updateMany({ where: { id: row.id, tokenHash: null, revokedAt: null }, data: { tokenHash: hashSecret(token), tokenIssuedAt: now } });
    return issued.count === 1 ? { status: 'paired', token } : { status: 'already_issued' };
  }

  // Credencial do relogio -> aparelho e aluna. Retirada ou desconhecida: 401.
  async authenticate(token: string, now: Date = new Date()): Promise<{ deviceId: string; userId: string }> {
    const row = await this.prisma.wearDevice.findUnique({ where: { tokenHash: hashSecret(token) }, select: { id: true, userId: true, revokedAt: true, lastSeenAt: true } });
    if (!row || !row.userId || row.revokedAt) throw new UnauthorizedException();
    if (!row.lastSeenAt || now.getTime() - row.lastSeenAt.getTime() > LAST_SEEN_MIN_INTERVAL_MS) {
      await this.prisma.wearDevice.update({ where: { id: row.id }, data: { lastSeenAt: now } }).catch(() => undefined);
    }
    return { deviceId: row.id, userId: row.userId };
  }

  async week(userId: string): Promise<{ generatedAt: string; sessions: WearSession[] }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { subscriptionStatus: true } });
    if (!user || !hasSubscriptionAccess(user.subscriptionStatus)) throw new ForbiddenException({ code: 'sem_acesso', message: 'Sem acesso ativo ao Panzeri Run.' });
    const today = todayInSaoPaulo();
    const from = new Date(today.getTime() - WEEK_BACK_DAYS * 86_400_000);
    const to = new Date(today.getTime() + WEEK_AHEAD_DAYS * 86_400_000);
    const rows = await this.prisma.trainingSession.findMany({
      where: { userId, scheduledDate: { gte: from, lte: to }, plan: { status: 'active' } },
      select: { id: true, scheduledDate: true, weekday: true, modality: true, title: true, durationMin: true, distanceKm: true, structure: true, origin: true, completion: { select: { status: true } } },
    });
    return { generatedAt: new Date().toISOString(), sessions: wearSessionsOf(rows.map((row) => ({ ...row, completionStatus: row.completion?.status ?? null }))) };
  }

  async devices(userId: string) {
    const rows = await this.prisma.wearDevice.findMany({ where: { userId, revokedAt: null, confirmedAt: { not: null } }, orderBy: { confirmedAt: 'desc' }, select: { id: true, deviceName: true, platform: true, confirmedAt: true, lastSeenAt: true } });
    return rows.map((row) => ({ id: row.id, name: row.deviceName ?? 'Relógio', platform: row.platform, pairedAt: row.confirmedAt?.toISOString() ?? null, lastSeenAt: row.lastSeenAt?.toISOString() ?? null }));
  }

  async revoke(userId: string, deviceId: string): Promise<{ revoked: boolean }> {
    const result = await this.prisma.wearDevice.updateMany({ where: { id: deviceId, userId, revokedAt: null }, data: { revokedAt: new Date(), tokenHash: null } });
    if (result.count === 0) throw new NotFoundException('Relógio não encontrado.');
    return { revoked: true };
  }
}
