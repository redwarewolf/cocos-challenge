import { ArgumentsHost, HttpStatus } from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';
import { QueryFailedFilter } from './query-failed.filter';

describe('QueryFailedFilter', () => {
  const reply = jest.fn();
  const errorLog = jest.fn();

  const httpAdapterHost = {
    httpAdapter: { reply },
  } as unknown as HttpAdapterHost;
  const logger = {
    setContext: jest.fn(),
    error: errorLog,
  } as unknown as PinoLogger;

  const response = { fake: 'response' };
  const host = {
    switchToHttp: () => ({ getResponse: () => response }),
  } as unknown as ArgumentsHost;

  // `expect.any()` está tipado como `any`: se tipa una vez acá en vez de castear en cada
  // aserción. El mensaje exacto no se afirma a propósito — es texto para humanos.
  const cualquierMensaje = expect.any(String) as unknown as string;

  let filter: QueryFailedFilter;

  beforeEach(() => {
    jest.clearAllMocks();
    filter = new QueryFailedFilter(httpAdapterHost, logger);
  });

  /** El driver de pg cuelga el SQLSTATE de `code` sobre el error nativo. */
  function pgError(code: string, message = 'db exploded'): QueryFailedError {
    return new QueryFailedError(
      'INSERT INTO orders ...',
      [],
      Object.assign(new Error(message), { code }),
    );
  }

  it.each<[string, string, HttpStatus]>([
    ['22003', 'numérico fuera de rango', HttpStatus.BAD_REQUEST],
    ['22001', 'texto demasiado largo', HttpStatus.BAD_REQUEST],
    ['23503', 'foreign key inexistente', HttpStatus.BAD_REQUEST],
    ['23514', 'check constraint', HttpStatus.BAD_REQUEST],
  ])('%s (%s) responde 400', (code, _descripcion, expected) => {
    filter.catch(pgError(code), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: expected, message: cualquierMensaje },
      expected,
    );
  });

  it('23505 (unique violation) responde 409, no 400', () => {
    filter.catch(pgError('23505'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      { statusCode: HttpStatus.CONFLICT, message: cualquierMensaje },
      HttpStatus.CONFLICT,
    );
  });

  it('un SQLSTATE no mapeado sigue siendo 500: es un bug del server, no del cliente', () => {
    filter.catch(pgError('42P01', 'relation does not exist'), host);

    expect(reply).toHaveBeenCalledWith(
      response,
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        message: 'Internal server error',
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('un error sin código tampoco se mapea', () => {
    const sinCodigo = new QueryFailedError('SELECT 1', [], new Error('boom'));

    filter.catch(sinCodigo, host);

    expect(reply).toHaveBeenCalledWith(
      response,
      expect.objectContaining({
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
      }),
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  });

  it('no filtra el mensaje de Postgres al cliente, pero sí lo loguea', () => {
    // El mensaje del driver nombra columnas y, en las violaciones de unicidad, valores de
    // otras filas: sirve para operar, no para devolver.
    const detalle = 'Key (userid, idempotencykey)=(7, retry-1) already exists';

    filter.catch(pgError('23505', detalle), host);

    const [, body] = reply.mock.calls[0] as unknown as [
      unknown,
      { message: string },
    ];
    expect(body.message).not.toContain(detalle);
    expect(errorLog).toHaveBeenCalledWith(
      { sqlstate: '23505', query: 'INSERT INTO orders ...' },
      detalle,
    );
  });
});
