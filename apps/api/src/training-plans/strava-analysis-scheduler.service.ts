import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { PrismaService } from '../prisma/prisma.service';
import { TrainingPlansService } from './training-plans.service';

// Roda a analise do Strava (cadencia, FC, padroes) na sua propria cadencia, desacoplada da
// geracao de treino de proposito — o treinador pediu explicitamente: por padrao 1x por mes por
// aluno (nao 1x por atividade postada, nem 1x por semana), com opcao de frequencia customizada
// por aluno (definida via chat do Gerente Tecnico) e um botao manual no painel pra forcar na hora.
// refreshStravaAnalysis() ja checa internamente se cada aluno esta "vencido" (30 dias por padrao,
// ou o customizado) e se ha atividade nova — rodar este cron todo dia so custa uma chamada de IA
// real quando os dois criterios batem, nunca so por o cron ter disparado.
@Injectable()
export class StravaAnalysisSchedulerService {
  private readonly logger = new Logger(StravaAnalysisSchedulerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly trainingPlans: TrainingPlansService,
  ) {}

  // 06:00 UTC = 03:00 em Sao Paulo — horario de baixo uso, roda todo dia mas so gera custo real
  // pros alunos que estiverem vencidos (ver refreshStravaAnalysis).
  // 04/09: trava contra sobreposicao (mesma logica do sync do Asaas) — com mais alunos conectados,
  // um dia com muitos "vencidos" de uma vez (cada um custando uma chamada de IA de verdade,
  // sequencial) pode demorar mais do que o esperado; sem isso, o cron de amanha comecaria por cima.
  private isRunning = false;

  @Cron('0 6 * * *')
  async refreshDueStudents() {
    if (this.isRunning) {
      this.logger.warn('Verificacao diaria de analise do Strava ainda estava rodando quando o horario de hoje chegou — pulando esta execucao.');
      return;
    }
    this.isRunning = true;
    try {
      const connections = await this.prisma.stravaConnection.findMany({ select: { userId: true } });
      let analyzed = 0;
      for (const connection of connections) {
        try {
          const result = await this.trainingPlans.refreshStravaAnalysis(connection.userId);
          if (result.analyzed) analyzed += 1;
        } catch (error) {
          this.logger.warn(`Falha ao atualizar analise do Strava para ${connection.userId}: ${(error as Error).message}`);
        }
      }
      this.logger.log(`Verificacao diaria de analise do Strava concluida: ${analyzed} de ${connections.length} aluno(s) com Strava conectado tinham analise vencida e foram atualizados.`);
    } finally {
      this.isRunning = false;
    }
  }
}
