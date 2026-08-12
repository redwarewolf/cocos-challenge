import { readFileSync } from 'fs';
import { join } from 'path';
import { Client } from 'pg';
import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';

let container: StartedPostgreSqlContainer | undefined;

/**
 * Levanta un Postgres real (Testcontainers), le aplica el esquema + seed de
 * `schema.sql`, y apunta `process.env.DATABASE_URL`/`DB_SSL` a esa instancia. Se usa
 * en vez de la base compartida de Neon para que los e2e no dependan de la red ni
 * puedan pisar datos reales, y para poder ejercitar features Postgres-específicas
 * (CTEs, DISTINCT ON, pg_advisory_xact_lock) que no corren en un mock/SQLite.
 */
export async function startTestDatabase(): Promise<void> {
  container = await new PostgreSqlContainer('postgres:16-alpine')
    .withDatabase('cocos_test')
    .withUsername('test')
    .withPassword('test')
    .start();

  const connectionUri = container.getConnectionUri();

  const client = new Client({ connectionString: connectionUri });
  await client.connect();
  const schema = readFileSync(join(__dirname, 'schema.sql'), 'utf-8');
  await client.query(schema);
  await client.end();

  process.env.DATABASE_URL = connectionUri;
  process.env.DB_SSL = 'false';
}

export async function stopTestDatabase(): Promise<void> {
  await container?.stop();
  container = undefined;
}
