import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Instrument } from './entities/instrument.entity';
import { MarketData } from './entities/market-data.entity';
import { Order } from './entities/order.entity';
import { User } from './entities/user.entity';

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  url: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  entities: [User, Instrument, Order, MarketData],
  migrations: [__dirname + '/migrations/*.{ts,js}'],
  // The DB already exists with production-like data; TypeORM must never
  // auto-create/alter tables. All schema changes go through explicit,
  // reviewed migrations (see src/database/migrations).
  synchronize: false,
};

export const AppDataSource = new DataSource(dataSourceOptions);
