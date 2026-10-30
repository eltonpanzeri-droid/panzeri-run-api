import { IsEnum, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';

export class CreateThreeKmTestDto {
  @IsInt()
  @Min(300)
  @Max(7200)
  totalSeconds!: number;

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(230)
  avgHeartRate?: number;

  @IsOptional()
  @IsInt()
  @Min(40)
  @Max(240)
  maxHeartRate?: number;

  @IsEnum(['rua', 'esteira'])
  environment!: string;

  @IsOptional()
  @IsString()
  notes?: string;

  // Data real em que o teste foi feito (AAAA-MM-DD). Sem ela, vale o dia do cadastro.
  @IsOptional()
  @Matches(/^d{4}-d{2}-d{2}$/, { message: 'performedAt deve estar no formato AAAA-MM-DD.' })
  performedAt?: string;
}
