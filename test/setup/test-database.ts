import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from '../../src/database/data-source';

let container: StartedPostgreSqlContainer | undefined;

/**
 * Levanta un Postgres real (Testcontainers), le corre las migraciones del proyecto y un
 * seed de test propio, y apunta `process.env.DATABASE_URL`/`DB_SSL` a esa instancia.
 *
 * Contra un Postgres real y no un mock/SQLite porque la lógica depende de features
 * Postgres-específicas (CTEs, `DISTINCT ON`, `pg_advisory_xact_lock`, `ON CONFLICT`), y
 * descartable en vez de la base compartida para que ninguna corrida pueda tocar datos
 * reales. Correr las migraciones —en vez de un esquema hardcodeado— hace que el verde
 * pruebe también que construyen un esquema funcional desde cero.
 */
export async function startTestDatabase(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('cocos_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const connectionUri = container.getConnectionUri();
  process.env.DATABASE_URL = connectionUri;
  process.env.DB_SSL = 'false';

  const migrationDataSource = new DataSource(buildDataSourceOptions());
  await migrationDataSource.initialize();
  await migrationDataSource.runMigrations();
  await migrationDataSource.destroy();

  const client = new Client({ connectionString: connectionUri });
  await client.connect();
  const seed = readFileSync(join(__dirname, 'seed.sql'), 'utf-8');
  await client.query(seed);
  await client.end();
}

export async function stopTestDatabase(): Promise<void> {
  await container?.stop();
  container = undefined;
}
