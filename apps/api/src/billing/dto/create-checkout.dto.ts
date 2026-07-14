import { IsOptional, IsString } from 'class-validator';

export class CreateCheckoutDto {
  @IsOptional()
  @IsString()
  cpf?: string;
}
