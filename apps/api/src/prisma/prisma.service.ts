import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { installActivityExclusionFilter } from './activity-exclusion-scope';

@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  constructor() {
    super();
    // Atividade ignorada/excluida pela aluna ou treinador some de toda leitura de ActivityLog (ver activity-exclusion-scope.ts).
    installActivityExclusionFilter(this as never);
  }

  async onModuleInit() {
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }
}
