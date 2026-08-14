import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { LoggerModule } from 'nestjs-pino';
import { QueryFailedFilter } from './common/filters/query-failed.filter';
import { buildDataSourceOptions } from './database/data-source';
import { HealthModule } from './health/health.module';
import { InstrumentsModule } from './instruments/instruments.module';
import { buildLoggerOptions } from './logging/logger.config';
import { OrdersModule } from './orders/orders.module';
import { PortfolioModule } from './portfolio/portfolio.module';

@Module({
  imports: [
    LoggerModule.forRoot(buildLoggerOptions()),
    ConfigModule.forRoot({ isGlobal: true }),
    TypeOrmModule.forRootAsync({ useFactory: buildDataSourceOptions }),
    HealthModule,
    PortfolioModule,
    InstrumentsModule,
    OrdersModule,
  ],
  // Vía APP_FILTER y no `useGlobalFilters` en main.ts: así lo alcanza la inyección de
  // dependencias (necesita HttpAdapterHost y PinoLogger) y aplica también en los e2e, que
  // levantan la app con createNestApplication() sin pasar por bootstrap().
  providers: [{ provide: APP_FILTER, useClass: QueryFailedFilter }],
})
export class AppModule {}
