import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsOptional, Min, ValidateNested } from 'class-validator';
import { AvailabilityDayDto } from '../../me/dto/update-availability.dto';

export class UpdateStudentAvailabilityDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AvailabilityDayDto)
  availability!: AvailabilityDayDto[];

  // true (padrao) = o treinador quer ver o efeito na hora, gera a semana ja com a rotina nova.
  // false = so salva a rotina, igual a um pedido de mudanca do proprio aluno — entra em vigor na
  // proxima geracao automatica de domingo, sem gastar chamada de IA agora.
  @IsOptional()
  @IsBoolean()
  applyNow?: boolean;

  // (26/10/2026) Revisao da rotina carregada no painel. Obrigatoria quando a rotina ja' esta cadastrada (senao 400): protege contra sobrescrever uma alteracao mais recente.
  @IsOptional()
  @IsInt()
  @Min(0)
  expectedRevision?: number;
}
