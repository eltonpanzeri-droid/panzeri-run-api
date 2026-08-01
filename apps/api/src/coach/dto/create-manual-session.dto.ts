import { IsIn, IsString, Matches } from 'class-validator';

export class CreateManualSessionDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate deve estar no formato AAAA-MM-DD.' })
  scheduledDate!: string;

  @IsString()
  @IsIn(['corrida', 'esteira', 'forca', 'fortalecimento_corredores'])
  modality!: string;
}
