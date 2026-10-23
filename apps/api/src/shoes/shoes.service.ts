import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { decodeProfilePhoto } from '../profile-photo/profile-photo.service';
import { retrospectiveText, round2, type RaceRef } from '../equipment/equipment-core';
import { loadShoeUsageFacts, type ShoeUsageFact } from '../equipment/shoe-facts';
import { buildShoeStats, type ShoeStats } from '../equipment/shoe-stats';
import { UpsertShoeDto } from './dto/upsert-shoe.dto';

// Meus Tenis (04/10/2026) + Equipamentos (23/10/2026). Km acumulado e numero de corridas NUNCA sao armazenados — sempre derivados em tempo de leitura a partir de ShoeUsage + a atividade
// real por tras dela (ver equipment/shoe-facts.ts, fonte unica compartilhada com o painel). Ciclo de vida (cadastro, edicao, aposentadoria, reativacao) vira ShoeEvent (append-only).
//
// Status de WorkoutCompletion considerados "treino valido" pra' contagem: 'done' e 'adjusted' (mesma convencao do resto do app — 'missed' nunca e' execucao).

// Modalidades em que a pergunta "qual tenis" faz sentido (corrida/esteira) — mesmo agrupamento usado em session-execution-link.service.ts.
export const RUNNING_MODALITIES = ['corrida', 'esteira'];

interface ShoeRow {
  id: string; brand: string; model: string; version: string | null; nickname: string | null; photoUrl: string | null;
  status: string; startedUsingAt: Date; retiredAt: Date | null;
}

@Injectable()
export class ShoesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const shoes = await this.prisma.shoe.findMany({ where: { userId }, orderBy: { createdAt: 'desc' } });
    const summaries = await this.summarizeMany(userId, shoes);
    return {
      active: summaries.filter((s) => s.status === 'active'),
      retired: summaries.filter((s) => s.status === 'retired'),
    };
  }

  async create(userId: string, dto: UpsertShoeDto) {
    const startedUsingAt = this.parseDate(dto.startedUsingAt);
    const shoe = await this.prisma.shoe.create({
      data: {
        userId,
        brand: dto.brand.trim(),
        model: dto.model.trim(),
        version: dto.version?.trim() || null,
        nickname: dto.nickname?.trim() || null,
        photoUrl: dto.photoUrl?.trim() || null,
        startedUsingAt,
        events: { create: { userId, type: 'registered', details: { startedUsingAt: startedUsingAt.toISOString() } } },
      },
    });
    return (await this.summarizeMany(userId, [shoe]))[0];
  }

  async update(userId: string, shoeId: string, dto: UpsertShoeDto) {
    const existing = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!existing) throw new NotFoundException('Tenis nao encontrado.');
    const startedUsingAt = this.parseDate(dto.startedUsingAt);
    const next = {
      brand: dto.brand.trim(),
      model: dto.model.trim(),
      version: dto.version?.trim() || null,
      nickname: dto.nickname?.trim() || null,
      photoUrl: dto.photoUrl?.trim() || null,
      startedUsingAt,
    };
    // Registra so' o que mudou (antes e depois): a historia do cadastro fica auditavel sem copiar o par inteiro a cada salvamento.
    const changes: Record<string, Prisma.InputJsonObject> = {};
    const before: Record<string, string | null> = { brand: existing.brand, model: existing.model, version: existing.version ?? null, nickname: existing.nickname ?? null, startedUsingAt: existing.startedUsingAt.toISOString() };
    const after: Record<string, string | null> = { brand: next.brand, model: next.model, version: next.version, nickname: next.nickname, startedUsingAt: startedUsingAt.toISOString() };
    for (const key of Object.keys(before)) if (before[key] !== after[key]) changes[key] = { from: before[key], to: after[key] };
    const shoe = await this.prisma.shoe.update({
      where: { id: shoeId },
      data: { ...next, ...(Object.keys(changes).length > 0 ? { events: { create: { userId, type: 'edited', details: changes } } } : {}) },
    });
    return (await this.summarizeMany(userId, [shoe]))[0];
  }

  // Aposentar nunca exclui nem desvincula ShoeUsage — so' tira o par da lista de opcoes principais (listActiveForPicker) e registra o evento. Devolve a retrospectiva (so' fatos que existem).
  async retire(userId: string, shoeId: string) {
    const existing = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!existing) throw new NotFoundException('Tenis nao encontrado.');
    const shoe = existing.status === 'retired' ? existing : await this.changeStatus(userId, shoeId, 'active', 'retired');
    const summary = (await this.summarizeMany(userId, [shoe]))[0];
    return { ...summary, retrospective: await this.retrospectiveFor(userId, shoeId) };
  }

  // Reativar: volta a aparecer entre os ativos. A data de aposentadoria anterior continua nos eventos (historia); so' o estado atual muda.
  async reactivate(userId: string, shoeId: string) {
    const existing = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!existing) throw new NotFoundException('Tenis nao encontrado.');
    const shoe = existing.status === 'active' ? existing : await this.changeStatus(userId, shoeId, 'retired', 'active');
    return (await this.summarizeMany(userId, [shoe]))[0];
  }

  // Lista enxuta pro seletor do formulario de feedback — so' tenis ativos, com km acumulado.
  async listActiveForPicker(userId: string) {
    const shoes = await this.prisma.shoe.findMany({ where: { userId, status: 'active' }, orderBy: { createdAt: 'desc' } });
    return this.summarizeMany(userId, shoes);
  }

  async detail(userId: string, shoeId: string) {
    const shoe = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!shoe) throw new NotFoundException('Tenis nao encontrado.');
    const facts = await loadShoeUsageFacts(this.prisma, { where: { shoeId } });
    const stats = buildShoeStats(facts, await this.raceRefs(userId));
    const summary = (await this.summarizeMany(userId, [shoe], new Map([[shoeId, facts]])))[0];
    const history = [...facts]
      .sort((a, b) => b.completedAt.getTime() - a.completedAt.getTime())
      .slice(0, 20)
      .map((fact) => ({ completionId: fact.completionId, completedAt: fact.completedAt.toISOString(), localDate: fact.localDate, distanceKm: fact.distanceKm !== null ? round2(fact.distanceKm) : null }));
    const events = await this.prisma.shoeEvent.findMany({ where: { shoeId, userId }, orderBy: { occurredAt: 'asc' }, select: { id: true, type: true, occurredAt: true, details: true } });
    return {
      ...summary,
      stats,
      retrospective: summary.status === 'retired' ? this.retroFromStats(stats) : null,
      events: events.map((event) => ({ id: event.id, type: event.type, occurredAt: event.occurredAt.toISOString(), details: event.details })),
      history,
    };
  }

  // ── Foto opcional (mesma validacao da foto de perfil: JPEG ja' recortado, <= 60 KB) ──
  async getPhoto(userId: string, shoeId: string) {
    const photo = await this.prisma.shoePhoto.findFirst({ where: { shoeId, userId }, select: { data: true, mimeType: true, updatedAt: true } });
    if (!photo) return { dataUri: null };
    return { dataUri: `data:${photo.mimeType};base64,${Buffer.from(photo.data).toString('base64')}`, updatedAt: photo.updatedAt.toISOString() };
  }

  async setPhoto(userId: string, shoeId: string, imageBase64: unknown) {
    const shoe = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId }, select: { id: true } });
    if (!shoe) throw new NotFoundException('Tenis nao encontrado.');
    const buffer = decodeProfilePhoto(imageBase64);
    const row = await this.prisma.shoePhoto.upsert({
      where: { shoeId },
      create: { shoeId, userId, data: buffer, mimeType: 'image/jpeg', byteSize: buffer.length },
      update: { data: buffer, mimeType: 'image/jpeg', byteSize: buffer.length },
      select: { updatedAt: true },
    });
    return { hasPhoto: true, updatedAt: row.updatedAt.toISOString() };
  }

  async removePhoto(userId: string, shoeId: string) {
    const shoe = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId }, select: { id: true } });
    if (!shoe) throw new NotFoundException('Tenis nao encontrado.');
    await this.prisma.shoePhoto.deleteMany({ where: { shoeId, userId } });
    return { hasPhoto: false };
  }

  // Associa, troca ou remove o tenis de UMA execucao (WorkoutCompletion). shoeId=null remove a associacao. Upsert por workoutCompletionId (unique): trocar nunca deixa duas linhas
  // ativas pra' mesma execucao, entao nunca ha' dupla contagem.
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

  // Troca de estado condicional ('so' se ainda estiver em "from"): dois toques seguidos geram UM evento e nunca sobrescrevem retiredAt. Estado e evento na mesma transacao.
  private async changeStatus(userId: string, shoeId: string, from: 'active' | 'retired', to: 'active' | 'retired') {
    await this.prisma.$transaction(async (tx) => {
      const changed = await tx.shoe.updateMany({ where: { id: shoeId, userId, status: from }, data: { status: to, retiredAt: to === 'retired' ? new Date() : null } });
      if (changed.count === 1) await tx.shoeEvent.create({ data: { shoeId, userId, type: to === 'retired' ? 'retired' : 'reactivated' } });
    });
    const shoe = await this.prisma.shoe.findFirst({ where: { id: shoeId, userId } });
    if (!shoe) throw new NotFoundException('Tenis nao encontrado.');
    return shoe;
  }

  // ── internos ──
  private parseDate(value: string): Date {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) throw new BadRequestException('Data de inicio de uso invalida.');
    return date;
  }

  private async raceRefs(userId: string): Promise<RaceRef[]> {
    const races = await this.prisma.targetRace.findMany({ where: { userId }, select: { raceDate: true, distanceKm: true } });
    return races.map((race) => ({ raceDate: race.raceDate.toISOString().slice(0, 10), distanceKm: race.distanceKm }));
  }

  private retroFromStats(stats: ShoeStats): string | null {
    return retrospectiveText({ totalDistanceKm: stats.totalDistanceKm, runs: stats.runsCount, marathons: stats.marathons.confirmed, halfMarathons: stats.halfMarathons.confirmed, runsOver30: stats.runsOver30Km });
  }

  private async retrospectiveFor(userId: string, shoeId: string): Promise<string | null> {
    const facts = await loadShoeUsageFacts(this.prisma, { where: { shoeId } });
    return this.retroFromStats(buildShoeStats(facts, await this.raceRefs(userId)));
  }

  // Resumo de varios tenis de um aluno com UMA leitura de fatos (nunca N consultas por tenis).
  private async summarizeMany(userId: string, shoes: ShoeRow[], prepared?: Map<string, ShoeUsageFact[]>) {
    if (shoes.length === 0) return [];
    const factsByShoe = new Map<string, ShoeUsageFact[]>(prepared ?? []);
    const missing = shoes.filter((shoe) => !factsByShoe.has(shoe.id)).map((shoe) => shoe.id);
    if (missing.length > 0) {
      for (const id of missing) factsByShoe.set(id, []);
      for (const fact of await loadShoeUsageFacts(this.prisma, { where: { userId, shoeIds: missing } })) factsByShoe.get(fact.shoeId)?.push(fact);
    }
    const photos = await this.prisma.shoePhoto.findMany({ where: { userId, shoeId: { in: shoes.map((shoe) => shoe.id) } }, select: { shoeId: true } });
    const withPhoto = new Set(photos.map((photo) => photo.shoeId));
    return shoes.map((shoe) => {
      const facts = factsByShoe.get(shoe.id) ?? [];
      const withDistance = facts.filter((fact) => fact.distanceKm != null);
      const total = withDistance.reduce((sum, fact) => sum + (fact.distanceKm as number), 0);
      const sorted = [...facts].sort((a, b) => a.completedAt.getTime() - b.completedAt.getTime());
      return {
        id: shoe.id,
        brand: shoe.brand,
        model: shoe.model,
        version: shoe.version ?? null,
        nickname: shoe.nickname,
        photoUrl: shoe.photoUrl,
        hasPhoto: withPhoto.has(shoe.id),
        status: shoe.status,
        startedUsingAt: shoe.startedUsingAt.toISOString(),
        retiredAt: shoe.retiredAt?.toISOString() ?? null,
        workoutsCount: facts.length,
        totalDistanceKm: facts.length > 0 ? round2(total) : 0,
        // Media so' sobre as corridas com distancia conhecida (ausencia nao e' zero); null sem nenhuma.
        averageKmPerWorkout: withDistance.length > 0 ? round2(total / withDistance.length) : null,
        firstUsedAt: sorted[0]?.completedAt.toISOString() ?? null,
        lastUsedAt: sorted[sorted.length - 1]?.completedAt.toISOString() ?? null,
      };
    });
  }
}
