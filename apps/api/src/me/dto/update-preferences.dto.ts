import { Type } from 'class-transformer';
import { IsArray, IsDate, IsOptional, IsString } from 'class-validator';

export class UpdatePreferencesDto {
  @IsArray()
  @IsString({ each: true })
  preferredModalities!: string[];

  @IsArray()
  @IsString({ each: true })
  otherModalities!: string[];

  @IsArray()
  @IsString({ each: true })
  trainingLocations!: string[];

  @IsString()
  mainGoal!: string;

  @IsOptional()
  @Type(() => Date)
  @IsDate()
  targetRaceDate?: Date;

  @IsOptional()
  @IsString()
  strengthAddOn?: string;

  @IsOptional()
  @IsString()
  experienceLevel?: string;
}
