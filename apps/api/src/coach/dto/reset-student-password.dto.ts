import { IsString, MinLength } from 'class-validator';

export class ResetStudentPasswordDto {
  @IsString()
  @MinLength(8)
  password!: string;
}
