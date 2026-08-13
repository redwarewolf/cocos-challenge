import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AdvisoryLock } from '../database/advisory-lock';
import { Instrument } from '../database/entities/instrument.entity';
import { Order } from '../database/entities/order.entity';
import { User } from '../database/entities/user.entity';
import { ValuationModule } from '../valuation/valuation.module';
import { IdempotentOrderWriter } from './idempotent-order-writer';
import { OrderPricingService } from './order-pricing.service';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Order, User, Instrument]),
    ValuationModule,
  ],
  controllers: [OrdersController],
  providers: [
    OrdersService,
    OrderPricingService,
    IdempotentOrderWriter,
    AdvisoryLock,
  ],
})
export class OrdersModule {}
