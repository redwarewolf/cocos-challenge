import 'dotenv/config';
import { DataSource, DataSourceOptions } from 'typeorm';
import { Instrument } from './entities/instrument.entity';
import { MarketData } from './entities/market-data.entity';
import { Order } from './entities/order.entity';
import { User } from './entities/user.entity';

/**
 * Factory (no un objeto estático) para que la conexión se resuelva recién cuando Nest
 * bootea la app, no cuando este módulo se importa. Los tests e2e aprovechan esto: pisan
 * `DATABASE_URL`/`DB_SSL` (apuntando a un Postgres real de Testcontainers) antes de crear
 * el TestingModule, y la app arranca contra esa base en vez de la real.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  return {
    type: 'postgres',
    url: process.env.DATABASE_URL,
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false },
    entities: [User, Instrument, Order, MarketData],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    // La DB ya existe con datos reales; TypeORM no debe auto-crear/alterar tablas nunca.
    // Todo cambio de esquema pasa por migraciones explícitas y revisadas (ver
    // src/database/migrations).
    synchronize: false,
  };
}

export const dataSourceOptions: DataSourceOptions = buildDataSourceOptions();

export const AppDataSource = new DataSource(dataSourceOptions);
