import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { pickCanonicalPerEvent } from '../activity-execution/canonical-observation';
import { UpsertShoeDto } from './dto/upsert-shoe.dto';

// Meus Tenis (04/10/2026). Km acumulado e numero de treinos NUNCA sao armazenados — sempre
// derivados em tempo de leitura a partir de ShoeUsage + a atividade real por tras dela. Ver
// comentario completo em schema.prisma (model Shoe/ShoeUsage) pro racional da fonte de distancia.
//
// Status de WorkoutCompletion considerados "treino valido" pra' contagem: 'done' e 'adjusted'
// (mesma convencao usada em todo o resto do app — 'missed' nunca e' uma execucao).
const VALID_COMPLETION_STATUSES = ['done', 'adjusted'];

// Modalidades em que a pergunta "qual tenis" faz sentido (corrida/esteira) — mesmo agrupamento
// usado em session-execution-link.service.ts (MODALITY_COMPATIBILITY) pra' corrida/esteira.
export const RUNNING_MODALITIES = ['corrida', 'esteira'];

interface UsageRow {
  completionId: string;
  completedAt: Date;
  distanceKm: number | null;
}

@Injectable()
export class ShoesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const shoes = await this.prisma.shoe.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const summaries = await Promise.all(shoes.map((shoe) => this.summarize(shoe)));
    return {
      active: summaries.filter((s) => s.status === 'active'),
      retired: summaries.filter((s) => s.status === 'retired'),
    };
  }

  async create(userId: string, dto: UpsertShoeDto) {
    const startedUsingAt = new Date(dto.startedUsingAt);
    if (Number.isNaN(startedUsingAt.getTime())) throw new BadRequestException('Data de inicio de uso invalida.');
    const shoe = await this.prisma.shoe.create({
      data: {
        userId,
        brand: dto.brand.trim(),
        model: dto.model.trim(),
        nickname: dto.nickname?.trim() || null,
        photoUrl: dto.photoUrl?.trim() || null,
        startedUsingAt,
      },
    });
    return this.summarize(shoe);
  }

  async update(userId: string, shoeId: string, dto: UpsertShoeDto) {
    const existing = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!existing) throw new NotFoundException('Tenis nao encontrado.');
    const startedUsingAt = new Date(dto.startedUsingAt);
    if (Number.isNaN(startedUsingAt.getTime())) throw new BadRequestException('Data de inicio de uso invalida.');
    const shoe = await this.prisma.shoe.update({
      where: { id: shoeId },
      data: {
        brand: dto.brand.trim(),
        model: dto.model.trim(),
        nickname: dto.nickname?.trim() || null,
        photoUrl: dto.photoUrl?.trim() || null,
        startedUsingAt,
      },
    });
    return this.summarize(shoe);
  }

  // Aposentar nunca exclui nem desvincula ShoeUsage — so' tira o par da lista de opcoes
  // principais (RUNNING_MODALITIES/listActiveForPicker). Nao implementado: exclusao destrutiva de
  // tenis com historico (pedido explicito pra NAO fazer).
  async retire(userId: string, shoeId: string) {
    const existing = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!existing) throw new NotFoundException('Tenis nao encontrado.');
    if (existing.status === 'retired') return this.summarize(existing);
    const shoe = await this.prisma.shoe.update({ where: { id: shoeId }, data: { status: 'retired', retiredAt: new Date() } });
    return this.summarize(shoe);
  }

  // Lista enxuta pro seletor do formulario de feedback — so' tenis ativos, com km acumulado (pra'
  // exibir "327 km" no card de selecao sem pesar o fluxo).
  async listActiveForPicker(userId: string) {
    const shoes = await this.prisma.shoe.findMany({ where: { userId, status: 'active' }, orderBy: { createdAt: 'desc' } });
    const summaries = await Promise.all(shoes.map((shoe) => this.summarize(shoe)));
    return summaries;
  }

  async detail(userId: string, shoeId: string) {
    const shoe = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!shoe) throw new NotFoundException('Tenis nao encontrado.');

    const usages = await this.loadUsageRows(shoeId);
    const summary = this.computeTotals(usages);
    const history = usages
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
      .slice(0, 20)
      .map((u) => ({ completionId: u.completionId, completedAt: u.completedAt.toISOString(), distanceKm: u.distanceKm }));

    return {
      id: shoe.id,
      brand: shoe.brand,
      model: shoe.model,
      nickname: shoe.nickname,
      photoUrl: shoe.photoUrl,
      status: shoe.status,
      startedUsingAt: shoe.startedUsingAt.toISOString(),
      retiredAt: shoe.retiredAt?.toISOString() ?? null,
      ...summary,
      history,
    };
  }

  // Associa, troca ou remove o tenis de UMA execucao (WorkoutCompletion). shoeId=null remove a
  // associacao. Upsert por workoutCompletionId (unique): trocar nunca deixa duas linhas ativas pra'
  // mesma execucao, entao nunca ha' dupla contagem (Casos C/D/E do pedido original).
  async setUsage(userId: string, workoutCompletionId: string, shoeId: string | null) {
    const completion = await this.prisma.workoutCompletion.findFirst({ where: { id: workoutCompletionId, userId } });
    if (!completion) throw new NotFoundException('Registro de treino nao encontrado.');

    if (shoeId === null) {
      await this.prisma.shoeUsage.deleteMany({ where: { workoutCompletionId } });
      return null;
    }

    const shoe = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!shoe) throw new NotFoundException('Tenis nao encontrado.');

    return this.prisma.shoeUsage.upsert({
      where: { workoutCompletionId },
      create: { shoeId, workoutCompletionId, userId },
      update: { shoeId },
    });
  }

  async getUsageForCompletion(userId: string, workoutCompletionId: string) {
    return this.prisma.shoeUsage.findFirst({ where: { workoutCompletionId, userId } });
  }

  // Fonte de distancia (ver racional completo no schema.prisma, model ShoeUsage): atividade
  // canonica (ActivityLog, via SessionExecutionLink ATIVO) quando existir, senao o que o aluno
  // digitou no proprio feedback (WorkoutCompletion.distanceKm). Nunca inventa distancia quando
  // nenhuma das duas fontes tem o dado (Caso H do pedido original).
  //
  // 3C.3: a distancia vem da observacao CANONICA do PhysicalEvent (3A) — Polar + Apple do mesmo evento valem UMA distancia. Se o vinculo
  // ativo (legado ou decisao humana) esta' numa observacao nao-canonica, a distancia e' lida da canonica, sem alterar o vinculo. Atividade
  // 'unique' segue como antes; sem distancia objetiva, cai no que o aluno digitou (WorkoutCompletion.distanceKm).
  private async resolveDistanceKm(sessionId: string | null, fallbackDistanceKm: number | null): Promise<number | null> {
    if (!sessionId) return fallbackDistanceKm;
    const link = await this.prisma.sessionExecutionLink.findFirst({
      where: { trainingSessionId: sessionId, status: 'active' },
      orderBy: { createdAt: 'asc' },
      include: {
        activityLog: { select: { id: true, distanceMeters: true, physicalIdentityStatus: true, physicalEventId: true, physicalCanonicalActivityLogId: true } },
      },
    });
    if (!link) return fallbackDistanceKm;
    const [pick] = await pickCanonicalPerEvent([link.activityLog], (ids) =>
      this.prisma.activityLog.findMany({
        where: { userId: link.userId, id: { in: ids } },
        select: { id: true, distanceMeters: true, physicalIdentityStatus: true, physicalEventId: true, physicalCanonicalActivityLogId: true },
      }),
    );
    const distanceMeters = pick?.row.distanceMeters ?? null;
    return distanceMeters != null ? distanceMeters / 1000 : fallbackDistanceKm;
  }

  private async loadUsageRows(shoeId: string): Promise<UsageRow[]> {
    const usages = await this.prisma.shoeUsage.findMany({
      where: { shoeId },
      include: { workoutCompletion: { select: { id: true, sessionId: true, completedAt: true, distanceKm: true, status: true } } },
    });
    const valid = usages.filter((u) => VALID_COMPLETION_STATUSES.includes(u.workoutCompletion.status));
    const rows: UsageRow[] = [];
    for (const usage of valid) {
      const distanceKm = await this.resolveDistanceKm(usage.workoutCompletion.sessionId, usage.workoutCompletion.distanceKm);
      rows.push({ completionId: usage.workoutCompletion.id, completedAt: usage.workoutCompletion.completedAt, distanceKm });
    }
    return rows;
  }

  // Media calculada SO sobre os treinos com distancia conhecida — dividir pelo total de treinos
  // (incluindo os sem distancia) subestimaria a media tratando ausencia como zero, violando
  // "null nao e zero". Null (sem treinos com distancia conhecida) em vez de 0.
  private computeTotals(usages: UsageRow[]) {
    const workoutsCount = usages.length;
    const withDistance = usages.filter((u) => u.distanceKm != null);
    const totalDistanceKm = withDistance.reduce((sum, u) => sum + (u.distanceKm as number), 0);
    const averageKmPerWorkout = withDistance.length > 0 ? totalDistanceKm / withDistance.length : null;
    const sorted = [...usages].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
    return {
      workoutsCount,
      totalDistanceKm: workoutsCount > 0 ? Math.round(totalDistanceKm * 100) / 100 : 0,
      averageKmPerWorkout: averageKmPerWorkout != null ? Math.round(averageKmPerWorkout * 100) / 100 : null,
      firstUsedAt: sorted[0]?.completedAt.toISOString() ?? null,
      lastUsedAt: sorted[sorted.length - 1]?.completedAt.toISOString() ?? null,
    };
  }

  private async summarize(shoe: { id: string; brand: string; model: string; nickname: string | null; photoUrl: string | null; status: string; startedUsingAt: Date; retiredAt: Date | null }) {
    const usages = await this.loadUsageRows(shoe.id);
    const totals = this.computeTotals(usages);
    return {
      id: shoe.id,
      brand: shoe.brand,
      model: shoe.model,
      nickname: shoe.nickname,
      photoUrl: shoe.photoUrl,
      status: shoe.status,
      startedUsingAt: shoe.startedUsingAt.toISOString(),
      retiredAt: shoe.retiredAt?.toISOString() ?? null,
      ...totals,
    };
  }
}
