import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instrument } from '../database/entities/instrument.entity';
import { Order } from '../database/entities/order.entity';
import { ValuationService } from './valuation.service';

@Module({
  imports: [TypeOrmModule.forFeature([Order, Instrument])],
  providers: [ValuationService],
  exports: [ValuationService],
})
export class ValuationModule {}
