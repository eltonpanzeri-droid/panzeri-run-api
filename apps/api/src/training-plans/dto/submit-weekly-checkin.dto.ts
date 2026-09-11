import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

// 11/09: DTO expandido para o check-in v2 (15 perguntas em 3 blocos). Os 4 campos de contagem
// de sessoes continuam obrigatorios (o aluno ja viu e confirmou esses valores na tela de
// confirmacao antes de responder as perguntas). Os 15 campos de perguntas sao todos opcionais
// para compatibilidade: v1 envia os 3 antigos, v2 envia os 15 novos. O service detecta a versao
// pelo campo checkinVersion que vem no payload, ou pela presenca dos novos campos.
// Os 3 campos antigos ficam opcionais para nao quebrar versoes antigas do app.
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

  // Versao do formulario: 1 = 3 perguntas (legado), 2 = 15 perguntas. Opcional para backward compat.
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(2)
  checkinVersion?: number;

  // --- V1 (3 perguntas, 31/08) — opcionais, enviados por versoes antigas do app ---
  // elaborationSatisfaction===0 era o sentinel de "pulou" (Min(0) preserva isso)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  elaborationSatisfaction?: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  adherenceSatisfaction?: number;

  // nextWeekMotivation compartilhado: v1 (pergunta 3) e v2 (pergunta 11, bloco 3)
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  nextWeekMotivation?: number;

  // --- V2 Bloco 1: Como foi sua semana ---
  // P1: "Como voce avalia a proposta de treinos dessa semana?" (1=Pessima, 5=Otima)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  prescriptionLiking?: number;

  // P2: "A semana de treinos pareceu adequada a sua situacao atual?" (1=Pouco adequada, 5=Muito adequada)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  prescriptionSuitability?: number;

  // P3: "O quanto voce conseguiu executar os treinos como planejado?" (1=Quase nada, 5=Tudo)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  perceivedExecution?: number;

  // P4: "Quao satisfeito(a) voce ficou com sua execucao da semana?" (1=Insatisfeito, 5=Muito satisfeito)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  executionSatisfaction?: number;

  // P5: "Ao final dessa semana, como esta sua motivacao para continuar treinando?" (1=Baixa, 5=Alta)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  postWeekMotivation?: number;

  // --- V2 Bloco 2: Como voce esta ---
  // P6: "Como foi a qualidade geral do seu sono nessa semana?" (1=Ruim, 5=Otimo)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  weeklySleep?: number;

  // P7: "Como voce esta se sentindo fisicamente agora?" (1=Muito cansado, 5=Otimo)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  currentPhysicalFatigue?: number;

  // P8: "Qual foi seu nivel de estresse nessa semana?" (1=Muito estressante, 5=Tranquila)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  weeklyStress?: number;

  // P9: "O quanto obrigacoes do dia a dia atrapalharam seus treinos?" (1=Atrapalharam muito, 5=Nao atrapalharam)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  routineInterference?: number;

  // P10: "Como seu corpo esta respondendo aos treinos comparado ao habitual?" (1=Pior que o normal, 5=Melhor que o normal)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  bodyResponseVsNormal?: number;

  // --- V2 Bloco 3: Proxima semana ---
  // P11: nextWeekMotivation — ver campo compartilhado acima
  // P12: "O quanto voce acredita que vai conseguir executar os treinos da proxima semana?" (1=Pouco confiante, 5=Muito confiante)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  nextWeekConfidence?: number;

  // P13: "Sua agenda da proxima semana tem espaco para os treinos?" (1=Agenda dificil, 5=Semana livre)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  expectedScheduleFeasibility?: number;

  // P14: "Como voce espera estar fisicamente no inicio da proxima semana?" (1=Cansado, 5=Recuperado)
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  expectedPhysicalState?: number;

  // P15: "O que voce prefere para a proxima semana?" — identificador semantico estaveis (nao texto livre)
  @IsOptional()
  @IsString()
  preferredNextWeekTraining?: string;
}
