import { IsString, MaxLength, MinLength } from 'class-validator';

export class ApplyCouponDto {
  @IsString()
  @MinLength(2)
  @MaxLength(40)
  code!: string;
}
