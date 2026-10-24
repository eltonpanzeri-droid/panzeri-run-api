import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { deriveDevice, type DerivedDevice } from './equipment-core';

// Equipamentos (23/10/2026) — REGISTRO AUTOMATICO de dispositivos. Reconstroi as linhas UserDevice de um aluno a partir das atividades JA recebidas (ActivityLog.providerMetrics, a proveniencia
// tecnica de cada fonte), de forma idempotente: rodar de novo nunca duplica (chave unica) nem toca na correcao manual do aluno; primeira/ultima vez e contagem sao RECALCULADAS, nao somadas.
//
// Quando roda (sem depender de a aluna abrir a tela nem de acao do administrador):
//  1) logo apos cada atividade ser gravada por QUALQUER integracao (Polar, Wahoo, Zepp, Health Connect, Apple Saude) — scheduleRefresh() agrupa varias atividades do mesmo aluno numa so' execucao;
//  2) rede de seguranca diaria: alunos com atividade recente ou ainda sem nenhum dispositivo registrado (cobre o historico anterior a esta funcionalidade e qualquer falha pontual).
// Strava nunca entra (politica de dados). Nenhuma chamada de rede nem de IA.

const DEBOUNCE_MS = 20_000;
const BOOTSTRAP_DELAY_MS = 120_000;
const RECENT_DAYS = 3;

interface Group { derived: DerivedDevice; count: number; first: Date; last: Date }

@Injectable()
export class DeviceRegistryService implements OnApplicationBootstrap {
  private readonly logger = new Logger(DeviceRegistryService.name);
  private readonly pending = new Map<string, NodeJS.Timeout>();
  private sweeping = false;

  constructor(private readonly prisma: PrismaService) {}

  // Uma recuperacao do historico logo depois da publicacao (uma vez por inicializacao), sem atrasar o boot e sem nunca derrubar a API.
  onApplicationBootstrap(): void {
    if (process.env.NODE_ENV === 'test') return;
    const timer = setTimeout(() => { void this.sweep().catch(() => undefined); }, BOOTSTRAP_DELAY_MS);
    timer.unref?.();
  }

  // Chamado pelas integracoes depois de gravar uma atividade. Nunca lanca e nunca bloqueia a ingestao: agenda a reconstrucao do aluno (varias atividades em sequencia viram UMA execucao).
  scheduleRefresh(userId: string): void {
    try {
      if (!userId || this.pending.has(userId)) return;
      const timer = setTimeout(() => {
        this.pending.delete(userId);
        void this.refreshForUser(userId).catch((error) => this.logger.warn(`Falha ao atualizar dispositivos do aluno: ${error instanceof Error ? error.message : String(error)}`));
      }, DEBOUNCE_MS);
      timer.unref?.();
      this.pending.set(userId, timer);
    } catch {
      /* agendar nunca pode afetar a ingestao */
    }
  }

  // Reconstroi as linhas de dispositivo de UM aluno (idempotente). Devolve quantos aparelhos/caminhos distintos encontrou.
  async refreshForUser(userId: string): Promise<number> {
    const activities = await this.prisma.activityLog.findMany({
      where: { userId, provider: { not: 'strava' } },
      select: { provider: true, startedAt: true, providerMetrics: true },
    });
    const groups = new Map<string, Group>();
    for (const activity of activities) {
      const derived = deriveDevice(activity.provider, activity.providerMetrics);
      if (!derived) continue;
      const key = derived.sourceProvider + '|' + derived.sourceDetail + '|' + derived.deviceKey;
      const group = groups.get(key);
      if (!group) groups.set(key, { derived, count: 1, first: activity.startedAt, last: activity.startedAt });
      else {
        group.count += 1;
        if (activity.startedAt < group.first) group.first = activity.startedAt;
        if (activity.startedAt > group.last) group.last = activity.startedAt;
        // Preenche o que uma observacao anterior nao trazia (mesmo aparelho, mais informacao); nunca troca um valor ja' conhecido.
        const d = group.derived;
        d.manufacturer ??= derived.manufacturer; d.model ??= derived.model; d.name ??= derived.name; d.deviceType ??= derived.deviceType; d.manufacturerBasis ??= derived.manufacturerBasis;
      }
    }
    // Aparelho visto antes sem modelo e depois com modelo no MESMO caminho: uma so' linha (a identificada), somando as contagens.
    const absorbed: Array<{ provider: string; detail: string; targetKey: string }> = [];
    for (const [key, group] of [...groups]) {
      if (group.derived.deviceKey !== '') continue;
      const siblings = [...groups.values()].filter((other) => other !== group && other.derived.sourceProvider === group.derived.sourceProvider && other.derived.sourceDetail === group.derived.sourceDetail && other.derived.deviceKey !== '');
      if (siblings.length !== 1) continue;
      const target = siblings[0];
      target.count += group.count;
      if (group.first < target.first) target.first = group.first;
      if (group.last > target.last) target.last = group.last;
      absorbed.push({ provider: group.derived.sourceProvider, detail: group.derived.sourceDetail, targetKey: target.derived.deviceKey });
      groups.delete(key);
    }
    for (const group of groups.values()) {
      const d = group.derived;
      const data = {
        observedManufacturer: d.manufacturer, observedModel: d.model, observedName: d.name, deviceType: d.deviceType, manufacturerBasis: d.manufacturerBasis,
        firstSeenAt: group.first, lastSeenAt: group.last, activityCount: group.count,
      };
      await this.prisma.userDevice.upsert({
        where: { userId_sourceProvider_sourceDetail_deviceKey: { userId, sourceProvider: d.sourceProvider, sourceDetail: d.sourceDetail, deviceKey: d.deviceKey } },
        create: { userId, sourceProvider: d.sourceProvider, sourceDetail: d.sourceDetail, deviceKey: d.deviceKey, ...data },
        update: data, // manualManufacturer/manualModel nao fazem parte do update: a correcao do aluno sobrevive
      });
    }
    // A linha "sem modelo" gravada numa passada anterior ja' foi absorvida: remove-a (uma so' linha por aparelho), levando a correcao manual dela para a identificada se esta ainda nao tiver.
    for (const item of absorbed) {
      const stale = await this.prisma.userDevice.findFirst({ where: { userId, sourceProvider: item.provider, sourceDetail: item.detail, deviceKey: '' } });
      if (!stale) continue;
      if (stale.manualManufacturer || stale.manualModel) {
        await this.prisma.userDevice.updateMany({
          where: { userId, sourceProvider: item.provider, sourceDetail: item.detail, deviceKey: item.targetKey, manualManufacturer: null, manualModel: null },
          data: { manualManufacturer: stale.manualManufacturer, manualModel: stale.manualModel, manualUpdatedAt: stale.manualUpdatedAt },
        });
      }
      await this.prisma.userDevice.deleteMany({ where: { id: stale.id, userId } });
    }
    return groups.size;
  }

  // Todos os alunos com atividade (uso administrativo explicito).
  async refreshAll(): Promise<{ users: number; devices: number }> {
    const rows = await this.prisma.activityLog.groupBy({ by: ['userId'], where: { provider: { not: 'strava' } } });
    let devices = 0;
    for (const row of rows) devices += await this.refreshForUser(row.userId);
    return { users: rows.length, devices };
  }

  // Rede de seguranca: alunos com atividade nos ultimos dias OU com atividade e nenhum dispositivo registrado (historico anterior, falha pontual, reinicio durante a espera).
  async sweep(): Promise<{ users: number }> {
    if (this.sweeping) return { users: 0 };
    this.sweeping = true;
    try {
      const since = new Date(Date.now() - RECENT_DAYS * 86_400_000);
      const [recent, withActivity, withDevice] = await Promise.all([
        this.prisma.activityLog.groupBy({ by: ['userId'], where: { provider: { not: 'strava' }, createdAt: { gte: since } } }),
        this.prisma.activityLog.groupBy({ by: ['userId'], where: { provider: { not: 'strava' } } }),
        this.prisma.userDevice.groupBy({ by: ['userId'] }),
      ]);
      const registered = new Set(withDevice.map((row) => row.userId));
      const targets = new Set<string>(recent.map((row) => row.userId));
      for (const row of withActivity) if (!registered.has(row.userId)) targets.add(row.userId);
      for (const userId of targets) {
        try { await this.refreshForUser(userId); } catch (error) { this.logger.warn(`Falha ao atualizar dispositivos de um aluno: ${error instanceof Error ? error.message : String(error)}`); }
      }
      this.logger.log(`Dispositivos: ${targets.size} aluno(s) atualizado(s) na varredura.`);
      return { users: targets.size };
    } finally {
      this.sweeping = false;
    }
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async dailySweep(): Promise<void> {
    try { await this.sweep(); } catch (error) { this.logger.warn(`Falha na varredura diaria de dispositivos: ${error instanceof Error ? error.message : String(error)}`); }
  }
}
