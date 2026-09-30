import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MEDAL_CATALOG } from './medal-catalog';

// Sistema de Medalhas (30/09/2026) — sincroniza o catálogo determinístico (medal-catalog.ts) pra
// dentro da tabela Achievement toda vez que a API sobe. Nunca escrevo/leio produção diretamente
// daqui (regra do projeto) — isso roda como parte normal do boot da aplicação, em qualquer
// ambiente (dev, staging, produção), como qualquer outro serviço do Nest.
//
// Idempotente por design: upsert por `code` (identificador estável). Nunca deleta uma Achievement
// que saiu do catálogo (evita apagar histórico de UserAchievement por engano) — só cria/atualiza.
// Mudar `code` de uma medalha já existente cria uma NOVA linha (nunca renomear code com conquistas
// reais, ver medal-catalog.ts).
@Injectable()
export class MedalCatalogSyncService implements OnModuleInit {
  private readonly logger = new Logger(MedalCatalogSyncService.name);

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit() {
    try {
      const result = await this.syncCatalog();
      this.logger.log(`Catálogo de medalhas sincronizado: ${result.created} criada(s), ${result.updated} atualizada(s) de ${MEDAL_CATALOG.length} no total.`);
    } catch (error) {
      // Nunca pode derrubar o boot da API por causa disso — pior caso, o catálogo fica
      // desatualizado até o próximo restart/deploy, mas o resto do sistema continua funcionando.
      this.logger.error(`Falha ao sincronizar catálogo de medalhas: ${error instanceof Error ? error.message : error}`);
    }
  }

  async syncCatalog(): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;

    for (const medal of MEDAL_CATALOG) {
      const existing = await this.prisma.achievement.findUnique({ where: { code: medal.code }, select: { id: true } });
      await this.prisma.achievement.upsert({
        where: { code: medal.code },
        create: {
          code: medal.code,
          category: medal.category,
          name: medal.name,
          description: medal.description,
          grau: medal.grau,
          threshold: medal.threshold,
          unit: medal.unit,
          ruleVersion: medal.ruleVersion,
          criteria: medal.criteria as Prisma.InputJsonValue,
          sortOrder: medal.sortOrder,
          active: medal.active,
        },
        update: {
          category: medal.category,
          name: medal.name,
          description: medal.description,
          grau: medal.grau,
          threshold: medal.threshold,
          unit: medal.unit,
          ruleVersion: medal.ruleVersion,
          criteria: medal.criteria as Prisma.InputJsonValue,
          sortOrder: medal.sortOrder,
          active: medal.active,
        },
      });
      if (existing) updated++;
      else created++;
    }

    return { created, updated };
  }
}
