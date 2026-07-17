import { ArrayMinSize, IsArray, IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class SendStudentMessageDto {
  @IsString()
  @MinLength(1)
  @MaxLength(2000)
  message!: string;

  @IsArray()
  @ArrayMinSize(1)
  @IsIn(['email'], { each: true })
  channels!: string[];
}
