import { IsEnum, IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

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
}
