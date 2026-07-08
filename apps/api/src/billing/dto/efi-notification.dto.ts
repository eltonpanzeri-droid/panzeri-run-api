import { IsString } from 'class-validator';

export class EfiNotificationDto {
  @IsString()
  notification!: string;
}