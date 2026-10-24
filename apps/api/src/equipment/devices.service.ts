import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { StudentIntegrationsService } from '../coach/student-integrations.service';
import { PLATFORM_LABEL, effectiveDevice, normalizeKey } from './equipment-core';

// Equipamentos (23/10/2026) — relogios/dispositivos do ALUNO. Fabricante != modelo != plataforma. O que a fonte informou fica em colunas observed* (proveniencia tecnica, nunca
// sobrescrita); a correcao do aluno fica em colunas manual* separadas. As linhas sao reconstruidas das atividades de forma idempotente (primeira/ultima vez e contagem recalculadas),
// entao a historia de "o que chegou, por qual caminho, de qual aparelho" persiste sem depender de um contador solto. Strava nunca entra (politica de dados).

export interface DeviceView {
  id: string;
  platform: string;
  platformLabel: string;
  sourceDetail: string | null;
  manufacturer: string | null;
  manufacturerSource: 'manual' | 'dispositivo_informou' | 'plataforma_exclusiva' | null;
  model: string | null;
  modelSource: 'manual' | 'dispositivo_informou' | null;
  deviceType: string | null;
  firstSeenAt: string | null;
  lastSeenAt: string | null;
  activityCount: number;
  // Proveniencia: o que a fonte informou, mesmo quando o aluno corrigiu (a correcao nunca apaga isto).
  observed: { manufacturer: string | null; model: string | null; name: string | null };
  corrected: boolean;
}

const MANUAL_MAX = 60;
const clean = (value: unknown): string | null => {
  if (value == null) return null;
  if (typeof value !== 'string') throw new BadRequestException('Valor invalido.');
  const text = value.trim().replace(/\s+/g, ' ');
  if (text.length > MANUAL_MAX) throw new BadRequestException('Texto longo demais (maximo ' + MANUAL_MAX + ' caracteres).');
  return text || null;
};

@Injectable()
export class DevicesService {
  constructor(private readonly prisma: PrismaService, private readonly integrations: StudentIntegrationsService) {}
  // A reconstrucao das linhas e automatica (DeviceRegistryService: a cada atividade recebida e em varredura diaria); aqui so' se le, se corrige e se cadastra.

  private view(row: Prisma.UserDeviceGetPayload<object>): DeviceView {
    const effective = effectiveDevice(row);
    return {
      id: row.id,
      platform: row.sourceProvider,
      platformLabel: PLATFORM_LABEL[row.sourceProvider] ?? row.sourceProvider,
      sourceDetail: row.sourceDetail || null,
      manufacturer: effective.manufacturer,
      manufacturerSource: effective.manufacturerSource,
      model: effective.model,
      modelSource: effective.modelSource,
      deviceType: row.deviceType,
      firstSeenAt: row.firstSeenAt?.toISOString() ?? null,
      lastSeenAt: row.lastSeenAt?.toISOString() ?? null,
      activityCount: row.activityCount,
      observed: { manufacturer: row.observedManufacturer, model: row.observedModel, name: row.observedName },
      corrected: Boolean(row.manualManufacturer || row.manualModel),
    };
  }

  // Tela do aluno: dispositivos conhecidos + estado de cada plataforma de integracao (conexao, ultima sincronizacao, tipos de informacao autorizados/recebidos).
  async forStudent(userId: string) {
    const rows = await this.prisma.userDevice.findMany({ where: { userId }, orderBy: [{ lastSeenAt: 'desc' }] });
    const integrations = await this.integrations.forStudent(userId);
    const platforms = integrations.integrations
      .filter((integration) => integration.state !== 'not_connected' || integration.categories.some((category) => (category.count ?? 0) > 0))
      .map((integration) => {
        const activity = integration.categories.find((category) => category.id === 'activity');
        return {
          provider: integration.provider,
          name: integration.name,
          state: integration.state,
          stateLabel: integration.stateLabel,
          lastSyncAt: integration.lastSyncAt,
          activityCount: activity?.count ?? null,
          categories: integration.categories
            .filter((category) => category.direction === 'recebe')
            .map((category) => ({ id: category.id, label: category.label, authorized: category.authorized, count: category.count, lastAt: category.lastAt })),
        };
      });
    return { devices: rows.map((row) => this.view(row)), platforms };
  }

  // Aparelho que nenhuma integracao identificou (ou ainda sem atividade): o aluno informa. Fica com plataforma 'manual' — nao ha' proveniencia tecnica a preservar, e isso fica explicito.
  async addManual(userId: string, input: { manufacturer?: unknown; model?: unknown }) {
    const manufacturer = clean(input.manufacturer);
    const model = clean(input.model);
    if (!manufacturer && !model) throw new BadRequestException('Informe fabricante e/ou modelo.');
    const deviceKey = normalizeKey((manufacturer ?? '') + ' ' + (model ?? '')).slice(0, 80);
    const row = await this.prisma.userDevice.upsert({
      where: { userId_sourceProvider_sourceDetail_deviceKey: { userId, sourceProvider: 'manual', sourceDetail: '', deviceKey } },
      create: { userId, sourceProvider: 'manual', sourceDetail: '', deviceKey, manualManufacturer: manufacturer, manualModel: model, manualUpdatedAt: new Date() },
      update: { manualManufacturer: manufacturer, manualModel: model, manualUpdatedAt: new Date() },
    });
    return this.view(row);
  }

  // Correcao do aluno: so' preenche as colunas manual*; o observado (proveniencia) permanece. Texto vazio remove a correcao daquele campo.
  async correct(userId: string, deviceId: string, input: { manufacturer?: unknown; model?: unknown }) {
    const row = await this.prisma.userDevice.findFirst({ where: { id: deviceId, userId } });
    if (!row) throw new NotFoundException('Dispositivo nao encontrado.');
    if (input.manufacturer === undefined && input.model === undefined) throw new BadRequestException('Informe fabricante e/ou modelo.');
    const manufacturer = input.manufacturer === undefined ? row.manualManufacturer : clean(input.manufacturer);
    const model = input.model === undefined ? row.manualModel : clean(input.model);
    const updated = await this.prisma.userDevice.update({ where: { id: deviceId }, data: { manualManufacturer: manufacturer, manualModel: model, manualUpdatedAt: new Date() } });
    return this.view(updated);
  }
}
