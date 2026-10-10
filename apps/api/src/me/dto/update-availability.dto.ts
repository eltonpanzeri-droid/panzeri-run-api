import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

export class AvailabilityDayDto {
  @IsInt()
  weekday!: number;

  @IsBoolean()
  noTraining!: boolean;

  @IsArray()
  modalities!: string[];

  @IsOptional()
  @IsInt()
  availableMin?: number | null;

  @IsOptional()
  @IsObject()
  modalityDurations?: Record<string, number>;
}

export class UpdateAvailabilityDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDayDto)
  availability!: AvailabilityDayDto[];

  // (10/2026) Observacao livre do aluno ao editar a rotina (ex.: "faco musculacao em outra academia"). Nao altera a rotina: segue ao fluxo geral de relatos
  // (Relator -> Prontuario), uma vez por texto.
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observation?: string;
}
