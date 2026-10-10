import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class UpdateHealthDto {
  @IsOptional()
  @IsInt()
  @Min(70)
  @Max(250)
  systolic?: number;

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(150)
  diastolic?: number;

  @IsOptional()
  @IsBoolean()
  diabetes?: boolean;

  @IsOptional()
  @IsString()
  previousSurgeries?: string;

  @IsOptional()
  @IsString()
  previousInjuries?: string;

  @IsOptional()
  @IsString()
  healthProblems?: string;

  @IsOptional()
  @IsString()
  medications?: string;

  // Valores historicos: a entrevista grava a RESPOSTA ORIGINAL (ex.: "Entre 6 e 7 horas", "7/10") nestes campos. Eles continuam aceitos (e preservados
  // sem conversao) para o formulario nao rejeitar o que o proprio sistema gravou; os valores novos seguem os enums do formulario.
  @IsOptional()
  @Matches(/^(menos_5|5_6|6_7|7_8|mais_8|(menos de|entre|mais de) [0-9]+( e [0-9]+)? horas?|nao informado)?$/i)
  averageSleep?: string;

  @IsOptional()
  @Matches(/^(baixo|moderado|alto|muito_alto|[0-9]{1,2}\/10|nao informado)?$/i)
  stressLevel?: string;

  @IsOptional()
  @Matches(/^(nao|leve|moderada|alta|[0-9]{1,2}\/10|nao informado)?$/i)
  anxietyLevel?: string;
}
