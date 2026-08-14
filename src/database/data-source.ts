import { DataSource, DataSourceOptions } from 'typeorm';
import { getConfig } from '../config/config';
import { Instrument } from './entities/instrument.entity';
import { MarketData } from './entities/market-data.entity';
import { Order } from './entities/order.entity';
import { User } from './entities/user.entity';

/**
 * Opciones de conexión, resueltas al llamar la función y no al importar el módulo: los e2e
 * pisan `DATABASE_URL`/`DB_SSL` en runtime para apuntar a un Postgres de Testcontainers.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  const config = getConfig();

  return {
    type: 'postgres',
    url: config.databaseUrl,
    // `true` verifica el certificado; `{ rejectUnauthorized: false }` solo cifraría.
    ssl: config.dbSsl,
    entities: [User, Instrument, Order, MarketData],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    // Todo cambio de esquema pasa por una migración explícita.
    synchronize: false,
  };
}

/** DataSource que consume el CLI de TypeORM (`npm run migration:run`/`migration:revert`). */
export const AppDataSource = new DataSource(buildDataSourceOptions());
