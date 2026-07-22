import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTargetRaceDto } from './dto/create-target-race.dto';
import { UpdateTargetRaceDto } from './dto/update-target-race.dto';

@Injectable()
export class TargetRacesService {
  constructor(private readonly prisma: PrismaService) {}

  async list(userId: string) {
    const races = await this.prisma.targetRace.findMany({
      where: { userId },
      orderBy: [{ status: 'asc' }, { raceDate: 'asc' }],
    });
    return races.map(withComputedPace);
  }

  async create(userId: string, dto: CreateTargetRaceDto) {
    const race = await this.prisma.targetRace.create({
      data: {
        userId,
        name: dto.name.trim(),
        raceDate: new Date(dto.raceDate),
        distanceKm: dto.distanceKm,
        targetSeconds: dto.targetSeconds,
        priority: dto.priority ?? 'principal',
        notes: dto.notes,
      },
    });
    return withComputedPace(race);
  }

  async update(userId: string, raceId: string, dto: UpdateTargetRaceDto) {
    const existing = await this.prisma.targetRace.findUnique({ where: { id: raceId } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Meta nao encontrada.');

    const race = await this.prisma.targetRace.update({
      where: { id: raceId },
      data: {
        name: dto.name?.trim(),
        raceDate: dto.raceDate ? new Date(dto.raceDate) : undefined,
        distanceKm: dto.distanceKm,
        targetSeconds: dto.targetSeconds,
        priority: dto.priority,
        status: dto.status,
        notes: dto.notes,
      },
    });
    return withComputedPace(race);
  }

  async remove(userId: string, raceId: string) {
    const existing = await this.prisma.targetRace.findUnique({ where: { id: raceId } });
    if (!existing || existing.userId !== userId) throw new NotFoundException('Meta nao encontrada.');
    await this.prisma.targetRace.delete({ where: { id: raceId } });
    return { removed: true };
  }

  // Usado pelo agente de prescricao: a meta "principal" mais proxima no tempo, ainda em andamento.
  async currentGoal(userId: string) {
    const race = await this.prisma.targetRace.findFirst({
      where: { userId, status: 'em_andamento' },
      orderBy: { raceDate: 'asc' },
    });
    if (!race) return null;
    return withComputedPace(race);
  }
}

function withComputedPace<T extends { distanceKm: number; targetSeconds: number | null }>(race: T) {
  if (!race.targetSeconds || !race.distanceKm) {
    return { ...race, paceSecondsPerKm: null, speedKmh: null };
  }
  const paceSecondsPerKm = Math.round(race.targetSeconds / race.distanceKm);
  const speedKmh = Number(((race.distanceKm / race.targetSeconds) * 3600).toFixed(2));
  return { ...race, paceSecondsPerKm, speedKmh };
}
