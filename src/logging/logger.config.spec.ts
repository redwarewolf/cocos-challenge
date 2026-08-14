import type { IncomingMessage, ServerResponse } from 'http';
import { buildLoggerOptions, genReqId } from './logger.config';

describe('genReqId', () => {
  const setHeader = jest.fn();

  beforeEach(() => {
    setHeader.mockClear();
  });

  const res = { setHeader } as unknown as ServerResponse;

  it('reusa el x-request-id entrante si el cliente ya mandó uno', () => {
    const req = {
      headers: { 'x-request-id': 'client-generated-id' },
    } as unknown as IncomingMessage;

    const id = genReqId(req, res);

    expect(id).toBe('client-generated-id');
    expect(setHeader).toHaveBeenCalledWith(
      'x-request-id',
      'client-generated-id',
    );
  });

  it('genera un UUID nuevo si no viene x-request-id', () => {
    const req = { headers: {} } as unknown as IncomingMessage;

    const id = genReqId(req, res);

    expect(id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });

  it('genera un UUID nuevo si el header viene vacío', () => {
    const req = {
      headers: { 'x-request-id': '' },
    } as unknown as IncomingMessage;

    const id = genReqId(req, res);

    expect(id).not.toBe('');
  });

  it('descarta un id con saltos de línea (inyección de líneas falsas en los logs)', () => {
    const inyectado = 'abc\n2026-01-01 ERROR fake log line';
    const req = {
      headers: { 'x-request-id': inyectado },
    } as unknown as IncomingMessage;

    const id = genReqId(req, res);

    expect(id).not.toBe(inyectado);
    expect(id).not.toContain('\n');
    expect(setHeader).toHaveBeenCalledWith('x-request-id', id);
  });

  it('descarta un id más largo que el máximo permitido', () => {
    const largo = 'a'.repeat(129);
    const req = {
      headers: { 'x-request-id': largo },
    } as unknown as IncomingMessage;

    expect(genReqId(req, res)).not.toBe(largo);
  });

  it('acepta un id de exactamente el largo máximo', () => {
    const enElLimite = 'a'.repeat(128);
    const req = {
      headers: { 'x-request-id': enElLimite },
    } as unknown as IncomingMessage;

    expect(genReqId(req, res)).toBe(enElLimite);
  });

  it('acepta los formatos de trace id habituales (UUID con guiones, nanoid con guiones bajos)', () => {
    for (const valido of [
      '550e8400-e29b-41d4-a716-446655440000',
      'V1StGXR8_Z5jdHi6B-myT',
    ]) {
      const req = {
        headers: { 'x-request-id': valido },
      } as unknown as IncomingMessage;

      expect(genReqId(req, res)).toBe(valido);
    }
  });

  it('descarta un id con caracteres fuera del formato, sin fallar el request', () => {
    const req = {
      headers: { 'x-request-id': 'id con espacios y ; puntuación' },
    } as unknown as IncomingMessage;

    expect(() => genReqId(req, res)).not.toThrow();
    expect(genReqId(req, res)).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
  });
});

describe('buildLoggerOptions', () => {
  const ORIGINAL_ENV = process.env;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
  });

  afterAll(() => {
    process.env = ORIGINAL_ENV;
  });

  it('nivel "silent" en test (NODE_ENV=test), sin importar LOG_LEVEL', () => {
    process.env.NODE_ENV = 'test';
    process.env.LOG_LEVEL = 'debug';

    expect(buildLoggerOptions().pinoHttp).toMatchObject({ level: 'silent' });
  });

  it('sin transport (JSON crudo) en producción', () => {
    process.env.NODE_ENV = 'production';

    expect(buildLoggerOptions().pinoHttp).toMatchObject({
      transport: undefined,
    });
  });

  it('con transport pino-pretty fuera de test/producción, y respeta LOG_LEVEL', () => {
    process.env.NODE_ENV = 'development';
    process.env.LOG_LEVEL = 'debug';

    const { pinoHttp } = buildLoggerOptions();

    expect(pinoHttp).toMatchObject({ level: 'debug' });
    expect(
      (pinoHttp as { transport?: { target?: string } }).transport?.target,
    ).toBe('pino-pretty');
  });
});
