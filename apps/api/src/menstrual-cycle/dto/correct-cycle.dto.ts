import { IsDateString, IsOptional, ValidateIf } from 'class-validator';

// Correcao retroativa de um ciclo ja registrado (chave ausente = nao mexe naquele campo;
// endDate: null explicito = "removeu o fim", nao "nao mandou nada" — ver secao 31 do pedido).
export class CorrectCycleDto {
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ValidateIf((o: CorrectCycleDto) => o.endDate !== null)
  @IsOptional()
  @IsDateString()
  endDate?: string | null;
}
