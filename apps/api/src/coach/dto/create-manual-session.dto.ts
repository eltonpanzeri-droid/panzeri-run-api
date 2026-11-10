import { Transform } from 'class-transformer';
import { IsIn, IsString, Matches } from 'class-validator';
import { canonicalModality } from '../../activity-execution/canonical-modality';

export class CreateManualSessionDto {
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'scheduledDate deve estar no formato AAAA-MM-DD.' })
  scheduledDate!: string;

  @Transform(({ value }) => (typeof value === 'string' && canonicalModality(value.trim()) === 'corrida' ? 'corrida' : value))
  @IsString()
  @IsIn(['corrida', 'forca', 'fortalecimento_corredores'])
  modality!: string;
}
