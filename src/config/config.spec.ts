import { getConfig, MAX_PAGE_SIZE, resolvePageSize } from './config';

describe('resolvePageSize', () => {
  it('usa 20 como default si no se define', () => {
    expect(resolvePageSize(undefined)).toBe(20);
  });

  it('respeta el valor si es un entero positivo válido', () => {
    expect(resolvePageSize('5')).toBe(5);
  });

  it.each(['abc', '-5', '0', '3.5', ''])(
    'ignora un valor inválido ("%s") y usa el default',
    (invalid) => {
      expect(resolvePageSize(invalid)).toBe(20);
    },
  );

  it('nunca deja que el resultado supere el techo fijo MAX_PAGE_SIZE', () => {
    expect(resolvePageSize('999')).toBe(MAX_PAGE_SIZE);
  });
});

describe('getConfig', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = {
      ...ORIGINAL_ENV,
      DATABASE_URL: 'postgresql://user:pass@host:5432/db',
    };
    delete process.env.DB_SSL;
    delete process.env.PORT;
    delete process.env.LOG_LEVEL;
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('databaseUrl es undefined si no está definida (no se valida acá a propósito, ver README)', () => {
    delete process.env.DATABASE_URL;
    expect(getConfig().databaseUrl).toBeUndefined();
  });

  it('dbSsl es true por default (sin DB_SSL definida)', () => {
    expect(getConfig().dbSsl).toBe(true);
  });

  it('dbSsl es false solo cuando DB_SSL="false"', () => {
    process.env.DB_SSL = 'false';
    expect(getConfig().dbSsl).toBe(false);
  });

  it('dbSsl sigue siendo true para cualquier otro valor de DB_SSL', () => {
    process.env.DB_SSL = 'nope';
    expect(getConfig().dbSsl).toBe(true);
  });

  it('port default es 3000 si PORT no está definido o es inválido', () => {
    expect(getConfig().port).toBe(3000);

    process.env.PORT = 'abc';
    expect(getConfig().port).toBe(3000);
  });

  it('respeta PORT si es un entero positivo válido', () => {
    process.env.PORT = '4000';
    expect(getConfig().port).toBe(4000);
  });

  it('devuelve el databaseUrl tal cual', () => {
    expect(getConfig().databaseUrl).toBe('postgresql://user:pass@host:5432/db');
  });

  it('logLevel default es "info" si LOG_LEVEL no está definida', () => {
    expect(getConfig().logLevel).toBe('info');
  });

  it('respeta LOG_LEVEL si está definida', () => {
    process.env.LOG_LEVEL = 'debug';
    expect(getConfig().logLevel).toBe('debug');
  });
});
