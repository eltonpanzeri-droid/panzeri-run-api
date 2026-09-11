import { IsBoolean, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class UpsertMenstrualProfileDto {
  // null = preferiu nao informar (chave ausente no payload = nao toca o campo)
  @IsOptional()
  @IsBoolean()
  hasActiveCycle?: boolean | null;

  @IsOptional()
  @IsBoolean()
  usesHormonalContraceptive?: boolean | null;

  // Identificadores semanticos estaveis (ex: 'pilula_combinada', 'diu_hormonal', 'implante', etc.)
  @IsOptional()
  @IsString()
  contraceptiveType?: string | null;

  // So faz sentido quando usesHormonalContraceptive=false — ciclo natural
  @IsOptional()
  @IsInt()
  @Min(21)
  @Max(40)
  cycleLengthDays?: number | null;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(10)
  periodLengthDays?: number | null;
}
