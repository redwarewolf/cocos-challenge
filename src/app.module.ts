import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDataSourceOptions } from './database/data-source';
import { HealthModule } from './health/health.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { OrdersModule } from './orders/orders.module';
import { PortfolioModule } from './portfolio/portfolio.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({ useFactory: buildDataSourceOptions }),
    HealthModule,
    PortfolioModule,
    InstrumentsModule,
    OrdersModule,
  ],
})
export class AppModule {}
