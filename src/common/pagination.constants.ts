import 'dotenv/config';

const DEFAULT_PAGE_SIZE = 20;

/**
 * Techo fijo (no configurable): protección básica contra pedir de más, no un knob de
 * tuning — no hace falta una segunda variable de entorno para esto.
 */
export const MAX_PAGE_SIZE = 100;

/**
 * Función pura (sin leer `process.env` directamente) para poder testearla sin recargar
 * el módulo: valida que sea un entero positivo, si no usa el default, y nunca deja que
 * supere `MAX_PAGE_SIZE`.
 */
export function resolvePageSize(rawValue: string | undefined): number {
  const parsed = Number(rawValue);
  const value =
    Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_PAGE_SIZE;
  return Math.min(value, MAX_PAGE_SIZE);
}

/**
 * Tamaño de página default, compartido por todos los endpoints paginados (búsqueda de
 * instrumentos, historial de órdenes), configurable con la env var PAGE_SIZE. `import
 * 'dotenv/config'` acá (además de en data-source.ts) asegura que process.env ya esté
 * poblado sin importar qué módulo se cargue primero en el grafo de imports — dotenv es
 * idempotente, llamarlo de nuevo no hace nada raro.
 */
export const PAGE_SIZE = resolvePageSize(process.env.PAGE_SIZE);
