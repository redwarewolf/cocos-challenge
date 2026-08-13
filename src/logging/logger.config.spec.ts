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
