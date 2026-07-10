import { BadRequestException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    if (!dto.acceptedTerms) {
      throw new BadRequestException('Aceite de termos e LGPD e obrigatorio.');
    }
    if (!dto.acceptedExerciseResponsibility) {
      throw new BadRequestException('A declaracao de aptidao e responsabilidade e obrigatoria.');
    }

    const email = dto.email.trim().toLowerCase();
    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new BadRequestException('E-mail ja cadastrado.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash,
        acceptedTermsAt: new Date(),
        acceptedPrivacyAt: new Date(),
        acceptedExerciseResponsibilityAt: new Date(),
      },
      select: this.publicUserSelect(),
    });

    return {
      user,
      tokens: await this.signTokens(user.id, user.email, user.role),
    };
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email.toLowerCase() } });
    if (!user) {
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    if (user.accountStatus !== 'active') {
      throw new UnauthorizedException('Conta sem acesso ativo.');
    }

    const validPassword = await bcrypt.compare(dto.password, user.passwordHash);
    if (!validPassword) {
      throw new UnauthorizedException('Credenciais invalidas.');
    }

    const role = this.effectiveRole(user.email, user.role);

    return {
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role,
      },
      tokens: await this.signTokens(user.id, user.email, role),
    };
  }

  async me(userId: string) {
    return this.prisma.user.findUniqueOrThrow({
      where: { id: userId },
      select: {
        ...this.publicUserSelect(),
        healthProfile: true,
        preferences: true,
        availability: {
          orderBy: { weekday: 'asc' },
        },
        tests: {
          where: { testType: '3km' },
          orderBy: { createdAt: 'desc' },
          take: 1,
        },
      },
    });
  }

  async startPasswordReset(email: string) {
    const cleanEmail = (email ?? '').trim().toLowerCase();
    if (!cleanEmail) {
      throw new BadRequestException('Informe o e-mail.');
    }

    const user = await this.prisma.user.findUnique({
      where: { email: cleanEmail },
      select: { id: true, email: true },
    });

    if (!user) {
      return {
        email: cleanEmail,
        message: 'Se este e-mail estiver cadastrado, um link de recuperacao sera gerado.',
      };
    }

    const token = randomBytes(32).toString('hex');
    await this.prisma.passwordResetToken.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24),
      },
    });

    return {
      email: user.email,
      resetLink: `${this.publicAppUrl()}/reset-password?token=${token}`,
      message: 'Link de recuperacao gerado. Abra o link para criar uma nova senha.',
    };
  }

  async resetPassword(dto: ResetPasswordDto) {
    const record = await this.prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(dto.token) },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      throw new BadRequestException('Link de recuperacao invalido ou expirado.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);
    await this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, accountStatus: 'active', refreshTokenHash: null },
      }),
      this.prisma.passwordResetToken.update({
        where: { id: record.id },
        data: { usedAt: new Date() },
      }),
    ]);

    return { message: 'Senha atualizada.' };
  }

  async refresh(refreshToken: string) {
    try {
      const payload = await this.jwt.verifyAsync<{ sub: string; email: string; role: string }>(refreshToken, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret',
      });

      const user = await this.prisma.user.findUnique({
        where: { id: payload.sub },
        select: { email: true, role: true, accountStatus: true, refreshTokenHash: true },
      });
      if (!user || user.accountStatus !== 'active' || user.refreshTokenHash !== hashToken(refreshToken)) {
        throw new UnauthorizedException('Refresh token invalido.');
      }

      return {
        tokens: await this.signTokens(payload.sub, user.email, this.effectiveRole(user.email, user.role)),
      };
    } catch {
      throw new UnauthorizedException('Refresh token invalido.');
    }
  }

  private async signTokens(userId: string, email: string, role: string) {
    const payload = { sub: userId, email, role };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_ACCESS_SECRET') ?? 'dev-access-secret',
        expiresIn: '12h',
      }),
      this.jwt.signAsync(payload, {
        secret: this.config.get<string>('JWT_REFRESH_SECRET') ?? 'dev-refresh-secret',
        expiresIn: '30d',
      }),
    ]);

    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshTokenHash: hashToken(refreshToken) },
    });

    return { accessToken, refreshToken };
  }

  private publicUserSelect() {
    return {
      id: true,
      email: true,
      name: true,
      role: true,
      accountStatus: true,
      birthDate: true,
      sex: true,
      heightCm: true,
      weightKg: true,
      address: true,
      acceptedExerciseResponsibilityAt: true,
      createdAt: true,
      updatedAt: true,
    };
  }

  private publicAppUrl() {
    return this.config.get<string>('APP_PUBLIC_URL') ?? 'https://agenteselton-panzeri-run-api.hbljgk.easypanel.host';
  }

  private effectiveRole(email: string, role: string) {
    const coachEmails = (this.config.get<string>('COACH_EMAILS') ?? '')
      .split(',')
      .map((item) => item.trim().toLowerCase())
      .filter(Boolean);

    if (coachEmails.includes(email.toLowerCase())) {
      return 'coach';
    }

    return role;
  }
}

function hashToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}

