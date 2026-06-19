import { IsBoolean, IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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

  @IsOptional()
  @IsEnum(['menos_5', '5_6', '6_7', '7_8', 'mais_8'])
  averageSleep?: string;

  @IsOptional()
  @IsEnum(['baixo', 'moderado', 'alto', 'muito_alto'])
  stressLevel?: string;

  @IsOptional()
  @IsEnum(['nao', 'leve', 'moderada', 'alta'])
  anxietyLevel?: string;
}
