import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateStudentDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  name?: string;

  @IsOptional()
  @IsEmail()
  email?: string;

  @IsOptional()
  @IsIn(['active', 'paused', 'canceled', 'overdue'])
  accountStatus?: string;
}
