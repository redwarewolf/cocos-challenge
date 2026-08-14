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
 * Levanta un Postgres real (Testcontainers), corre nuestras migraciones reales contra
 * él (las mismas que se aplican a la Neon de Cocos, único origen de verdad del esquema) y
 * carga un seed de test propio, y
 * apunta `process.env.DATABASE_URL`/`DB_SSL` a esa instancia. Se usa en vez de la base
 * compartida de Neon para que los e2e no dependan de la red ni puedan pisar datos
 * reales, para poder ejercitar features Postgres-específicas (CTEs, DISTINCT ON,
 * pg_advisory_xact_lock) que no corren en un mock/SQLite, y de yapa esto prueba que
 * nuestras migraciones realmente funcionan de punta a punta contra una base vacía.
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
