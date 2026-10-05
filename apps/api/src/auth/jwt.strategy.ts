import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../prisma/prisma.service';

// Conta excluida (anonimizada) nao pode continuar usando um access token ja emitido (ate 12 h). Consulta o status
// no maximo 1x por minuto por usuario.
const STATUS_TTL_MS = 60_000;

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly statusCache = new Map<string, number>(); // userId -> instante em que foi confirmado nao-excluido

  constructor(config: ConfigService, private readonly prisma: PrismaService) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret',
    });
  }

  async validate(payload: { sub: string; email: string; role: string }) {
    const checkedAt = this.statusCache.get(payload.sub);
    if (checkedAt === undefined || Date.now() - checkedAt > STATUS_TTL_MS) {
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { accountStatus: true } });
      if (user?.accountStatus === 'deleted') {
        this.statusCache.delete(payload.sub);
        throw new UnauthorizedException('Conta excluida.');
      }
      this.statusCache.set(payload.sub, Date.now());
    }
    return payload;
  }
}
