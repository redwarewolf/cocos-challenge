import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Instrument } from '../database/entities/instrument.entity';
import { Order } from '../database/entities/order.entity';
import { User } from '../database/entities/user.entity';
import { ValuationModule } from '../valuation/valuation.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, User, Instrument]),
    ValuationModule,
  ],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
