import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instrument } from '../database/entities/instrument.entity';
import { InstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';

@Module({
  imports: [TypeOrmModule.forFeature([Instrument])],
  controllers: [InstrumentsController],
  providers: [InstrumentsService],
  exports: [InstrumentsService],
})
export class InstrumentsModule {}
