import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsObject, IsOptional, IsString, MaxLength, Min, ValidateNested } from 'class-validator';

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

  // (26/10/2026) Revisao da rotina que o cliente carregou ao abrir o formulario. Se a rotina mudou depois (outra tela, treinador), a gravacao recebe 409 em vez de sobrescrever.
  // Opcional so' por compatibilidade com aplicativos antigos (sem protecao); os clientes atuais sempre enviam.
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}

// Alteracao PARCIAL: so' os dias enviados mudam. Revisao obrigatoria.
export class PatchAvailabilityDaysDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDayDto)
  days!: AvailabilityDayDto[];

  @IsInt()
  @Min(0)
  expectedRevision!: number;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  observation?: string;
}
