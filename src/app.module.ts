import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { buildDataSourceOptions } from './database/data-source';
import { HealthModule } from './health/health.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { buildLoggerOptions } from './logging/logger.config';
import { OrdersModule } from './orders/orders.module';
import { PortfolioModule } from './portfolio/portfolio.module';

@Module({
  imports: [
    LoggerModule.forRoot(buildLoggerOptions()),
    TypeOrmModule.forRootAsync({ useFactory: buildDataSourceOptions }),
    HealthModule,
    PortfolioModule,
    InstrumentsModule,
    OrdersModule,
  ],
})
export class AppModule {}
