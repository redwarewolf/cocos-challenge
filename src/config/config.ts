import 'dotenv/config';

const DEFAULT_PORT = 3000;
const DEFAULT_PAGE_SIZE = 20;
const DEFAULT_LOG_LEVEL = 'info';

/** Techo fijo (no configurable): protección básica contra pedir de más, no un knob de tuning. */
export const MAX_PAGE_SIZE = 100;

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

/** Función pura para poder testearla sin depender de `process.env`. */
export function resolvePageSize(rawValue: string | undefined): number {
  return Math.min(parsePositiveInt(rawValue, DEFAULT_PAGE_SIZE), MAX_PAGE_SIZE);
}

/**
 * Tamaño de página default (env var PAGE_SIZE, fallback 20), compartido por todos los
 * endpoints paginados. A diferencia de DATABASE_URL, ningún test lo pisa en runtime,
 * así que alcanza con resolverlo una sola vez al importar el módulo.
 */
export const PAGE_SIZE = resolvePageSize(process.env.PAGE_SIZE);

export interface AppConfig {
  /**
   * No se valida acá (se evaluó y se descartó — ver issue #11): si falta o está mal
   * escrita, el propio driver de Postgres/TypeORM falla al conectar con un error
   * suficientemente claro sobre cuál es el problema.
   */
  databaseUrl: string | undefined;
  dbSsl: boolean;
  port: number;
  logLevel: string;
}

/**
 * Función, no un objeto estático: DATABASE_URL/DB_SSL hay que resolverlos en el momento
 * (no al importar este módulo), porque los tests e2e los pisan en runtime, antes de
 * bootear la app, para apuntar a un Postgres descartable de Testcontainers en vez de la
 * base real (ver test/setup/test-database.ts). Si esto fuera un `const` de módulo,
 * quedaría "congelado" con el valor que tenía la primera vez que algo importó este
 * archivo — que podría ser antes de que el test llegue a pisar la variable.
 */
export function getConfig(): AppConfig {
  return {
    databaseUrl: process.env.DATABASE_URL,
    dbSsl: process.env.DB_SSL !== 'false',
    port: parsePositiveInt(process.env.PORT, DEFAULT_PORT),
    logLevel: process.env.LOG_LEVEL || DEFAULT_LOG_LEVEL,
  };
}
