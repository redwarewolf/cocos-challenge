import 'dotenv/config';

const DEFAULT_PORT = 3000;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_LOG_LEVEL = 'info';

/** Máximo de resultados que un request puede pedir, cualquiera sea el `limit` enviado. */
export const MAX_PAGE_SIZE = 100;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function resolvePageSize(rawValue: string | undefined): number {
  return Math.min(parsePositiveInt(rawValue, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
}

/** Tamaño de página cuando el request no manda `limit`, compartido por los endpoints paginados. */
export const PAGE_SIZE = resolvePageSize(process.env.PAGE_SIZE);

export interface AppConfig {
  databaseUrl: string | undefined;
  dbSsl: boolean;
  port: number;
  logLevel: string;
}

/**
 * Lee las env vars en el momento de la llamada, no al importar el módulo: los e2e pisan
 * `DATABASE_URL`/`DB_SSL` en runtime antes de bootear la app.
 */
export function getConfig(): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL,
    dbSsl: process.env.DB_SSL !== 'false',
    port: parsePositiveInt(process.env.PORT, DEFAULT_PORT),
    logLevel: process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL,
  };
}
