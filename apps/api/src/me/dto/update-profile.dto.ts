import { Type } from 'class-transformer';
import { IsDate, IsEmail, IsEnum, IsInt, IsNumber, IsOptional, IsString, Max, Min, MinLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @MinLength(2)
  name!: string;

  @Type(() => Date)
  @IsDate()
  birthDate!: Date;

  // 24/10: o banco e o app usam "Feminino"/"Masculino" (valor da entrevista); as formas minusculas antigas continuam aceitas e sao normalizadas no servidor (normalizeSex).
  @IsEnum(['masculino', 'feminino', 'outro', 'prefiro_nao_informar', 'Masculino', 'Feminino'])
  sex!: string;

  @IsInt()
  @Min(100)
  @Max(230)
  heightCm!: number;

  @IsNumber()
  @Min(30)
  @Max(250)
  weightKg!: number;

  @IsEmail()
  email!: string;

  @IsOptional()
  @IsString()
  address?: string;
}
