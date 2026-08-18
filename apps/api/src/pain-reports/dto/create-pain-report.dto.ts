import { ArrayNotEmpty, IsArray, IsIn, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

export class CreatePainReportDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  regions!: string[];

  @IsOptional()
  regionDetails?: Record<string, string[]>;

  @IsOptional()
  @IsString()
  otherLocation?: string;

  @IsInt()
  @Min(1)
  @Max(10)
  intensity!: number;

  @IsIn(['starts_then_stops', 'starts_mid', 'after_only', 'all_the_time'])
  onsetPattern!: string;

  @IsIn(['permanent', 'oscillating', 'specific_movements'])
  persistencePattern!: string;

  // Adicionados 18/08 a pedido do treinador (metodologia dele usa isso como parte da regua de
  // decisao sobre dor — "esta aumentando ou estavel" e "atrapalha o dia a dia" — ver
  // panzeri_methodology na memoria do projeto). Sem valor default fixo nem calculo automatico em
  // cima disso: e so mais contexto real que vai pro agente de IA julgar, igual todo o resto.
  @IsIn(['worsening', 'stable', 'improving'])
  worseningTrend!: string;

  @IsIn(['yes', 'a_little', 'no'])
  dailyLifeImpact!: string;

  @IsOptional()
  @IsIn(['none_before', 'resolved', 'improved', 'unchanged'])
  previousPainStatus?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  resolvedRegions?: string[];

  @IsOptional()
  @IsString()
  comment?: string;
}
