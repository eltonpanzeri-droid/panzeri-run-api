import { Module } from '@nestjs/common';
import { PrismaModule } from '../prisma/prisma.module';
import { ShoesController } from './shoes.controller';
import { ShoesService } from './shoes.service';

@Module({
  imports: [PrismaModule],
  controllers: [ShoesController],
  providers: [ShoesService],
  exports: [ShoesService],
})
export class ShoesModule {}
