import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsOptional, ValidateNested } from 'class-validator';
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
}
