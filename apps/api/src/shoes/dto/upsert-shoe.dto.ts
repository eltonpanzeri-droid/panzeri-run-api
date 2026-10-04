import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpsertShoeDto {
  @IsString()
  @MaxLength(80)
  brand!: string;

  @IsString()
  @MaxLength(80)
  model!: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  nickname?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  photoUrl?: string;

  @IsDateString()
  startedUsingAt!: string;
}
