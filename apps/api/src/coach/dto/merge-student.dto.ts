import { IsEmail } from 'class-validator';

export class MergeStudentDto {
  @IsEmail()
  sourceEmail!: string;
}
