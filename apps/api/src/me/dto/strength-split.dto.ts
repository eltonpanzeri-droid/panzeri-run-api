import { IsBoolean, IsInt, IsObject, IsOptional } from 'class-validator';

export class SaveStrengthSplitDto {
  // revisao da rotina sobre a qual a aluna respondeu (a mesma de GET /me/strength-split); outra revisao = 409.
  @IsInt()
  expectedRevision!: number;

  @IsBoolean()
  hasPreference!: boolean;

  // { "2": ["peito", "triceps"], "4": ["membros_inferiores"] } — chave = dia da semana; lista vazia = sem preferencia naquele dia.
  @IsOptional()
  @IsObject()
  days?: Record<string, unknown>;
}
