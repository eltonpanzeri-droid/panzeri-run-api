import { Module } from '@nestjs/common';
import { ProfilePhotoCoachController } from './profile-photo-coach.controller';
import { ProfilePhotoService } from './profile-photo.service';

@Module({
  controllers: [ProfilePhotoCoachController],
  providers: [ProfilePhotoService],
  exports: [ProfilePhotoService],
})
export class ProfilePhotoModule {}
