import { IsInt, Max, Min } from 'class-validator';

// Escala 1 (Detestei) a 5 (Amei) pras duas primeiras, mesmo padrao ja usado nas avaliacoes por
// sessao — familiar pro aluno. A terceira (motivacao) usa a mesma faixa numerica mas o rotulo e
// diferente (1 = Baixa, 5 = Alta), unica que olha pra frente em vez de avaliar o que passou.
export class SubmitWeeklyCheckInDto {
  // Numeros que o app mostrou na tela de confirmacao (GET weekly-checkin/status) — o aluno ja viu
  // e confirmou esses valores antes de responder as perguntas. Enviados de volta em vez de
  // recalculados no servidor de proposito: ver comentario em WeeklyCheckInService.submit sobre por
  // que recalcular podia divergir do que foi realmente confirmado.
  @IsInt()
  @Min(0)
  asPrescribedSessions!: number;

  @IsInt()
  @Min(0)
  changedModalitySessions!: number;

  @IsInt()
  @Min(0)
  differentSessions!: number;

  @IsInt()
  @Min(0)
  missedSessions!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  elaborationSatisfaction!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  adherenceSatisfaction!: number;

  @IsInt()
  @Min(1)
  @Max(5)
  nextWeekMotivation!: number;
}
