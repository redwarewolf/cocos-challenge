import { DataSource, DataSourceOptions } from 'typeorm';
import { getConfig } from '../config/config';
import { Instrument } from './entities/instrument.entity';
import { MarketData } from './entities/market-data.entity';
import { Order } from './entities/order.entity';
import { User } from './entities/user.entity';

/**
 * Factory (no un objeto estático) para que la conexión se resuelva recién cuando Nest
 * bootea la app, no cuando este módulo se importa. Los tests e2e aprovechan esto: pisan
 * `DATABASE_URL`/`DB_SSL` (apuntando a un Postgres real de Testcontainers) antes de crear
 * el TestingModule, y la app arranca contra esa base en vez de la real. `getConfig()` es
 * igual de lazy (ver src/config/config.ts), así que esta propiedad se preserva.
 */
export function buildDataSourceOptions(): DataSourceOptions {
  const config = getConfig();

  return {
    type: 'postgres',
    url: config.databaseUrl,
    // `true` y no `{ rejectUnauthorized: false }`: esto último cifra la conexión pero no
    // verifica contra quién, que es la mitad del punto de TLS. Neon emite certificados de
    // una CA pública, así que la verificación completa funciona sin configuración extra.
    // En local/Testcontainers `DB_SSL=false` y no hay TLS.
    ssl: config.dbSsl,
    entities: [User, Instrument, Order, MarketData],
    migrations: [__dirname + '/migrations/*.{ts,js}'],
    // La DB ya existe con datos reales; TypeORM no debe auto-crear/alterar tablas nunca.
    // Todo cambio de esquema pasa por migraciones explícitas y revisadas (ver
    // src/database/migrations).
    synchronize: false,
  };
}

/**
 * Solo lo usa el CLI de TypeORM (`npm run migration:run`/`migration:revert`), que necesita
 * un DataSource exportado. La app y los e2e llaman a la factory por su cuenta
 * (`AppModule` vía `useFactory`, `test/setup/test-database.ts`).
 */
export const AppDataSource = new DataSource(buildDataSourceOptions());
