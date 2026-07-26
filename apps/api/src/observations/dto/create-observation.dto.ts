import { IsString, MaxLength, MinLength } from 'class-validator';

export class CreateObservationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(800)
  content!: string;
}
