import { assertValidDatabaseUrl } from './assert-valid-database-url';

describe('assertValidDatabaseUrl', () => {
  it('no lanza con una connection string de Postgres válida', () => {
    expect(() =>
      assertValidDatabaseUrl(
        'postgresql://user:pass@host:5432/db?sslmode=require',
      ),
    ).not.toThrow();
  });

  it('acepta el scheme "postgres://" además de "postgresql://"', () => {
    expect(() =>
      assertValidDatabaseUrl('postgres://user:pass@host:5432/db'),
    ).not.toThrow();
  });

  it('lanza con mensaje claro si la variable no está definida', () => {
    expect(() => assertValidDatabaseUrl(undefined)).toThrow(
      /Falta la variable de entorno DATABASE_URL/,
    );
  });

  it('lanza con mensaje claro si la variable está vacía', () => {
    expect(() => assertValidDatabaseUrl('')).toThrow(
      /Falta la variable de entorno DATABASE_URL/,
    );
  });

  it('lanza si no tiene el scheme de Postgres (ej. mysql o http)', () => {
    expect(() => assertValidDatabaseUrl('mysql://user:pass@host/db')).toThrow(
      /debe ser una connection string de Postgres/,
    );
  });

  it('lanza si no es una URL válida', () => {
    expect(() =>
      assertValidDatabaseUrl('postgresql://not a valid url'),
    ).toThrow(/no es una URL válida/);
  });
});
