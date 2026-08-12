/**
 * Sin esto, un DATABASE_URL ausente o mal escrito falla recién dentro del driver de
 * Postgres, con un stack trace de conexión que no dice qué variable de entorno hay que
 * revisar. Se valida en un punto único (data-source.ts) usado tanto por el bootstrap de
 * Nest como por el CLI de migraciones (migration:run/revert), fuera del ciclo de Nest.
 */
export function assertValidDatabaseUrl(
  url: string | undefined,
): asserts url is string {
  if (!url) {
    throw new Error(
      'Falta la variable de entorno DATABASE_URL. Copiá .env.example a .env y completá la connection string.',
    );
  }
  if (!url.startsWith('postgres://') && !url.startsWith('postgresql://')) {
    throw new Error(
      `DATABASE_URL debe ser una connection string de Postgres (postgres:// o postgresql://); se recibió: "${url}"`,
    );
  }
  try {
    new URL(url);
  } catch {
    throw new Error(`DATABASE_URL no es una URL válida: "${url}"`);
  }
}
