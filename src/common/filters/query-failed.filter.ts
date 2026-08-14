import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpStatus,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { PinoLogger } from 'nestjs-pino';
import { QueryFailedError } from 'typeorm';

/**
 * Violaciones de constraint que un cliente puede provocar con un request válido en forma pero
 * inválido en contenido. Lo que no está acá es un bug del server y sigue saliendo como 500.
 */
const SQLSTATE_TO_RESPONSE: Record<
  string,
  { status: HttpStatus; message: string }
> = {
  '22001': {
    status: HttpStatus.BAD_REQUEST,
    message: 'A text value exceeds its maximum length',
  },
  '22003': {
    status: HttpStatus.BAD_REQUEST,
    message: 'A numeric value is out of the allowed range',
  },
  '23503': {
    status: HttpStatus.BAD_REQUEST,
    message: 'Referenced resource does not exist',
  },
  '23514': {
    status: HttpStatus.BAD_REQUEST,
    message: 'A value violates a database constraint',
  },
  '23505': {
    status: HttpStatus.CONFLICT,
    message: 'The resource already exists',
  },
};

/**
 * Red de seguridad detrás de la validación de los DTOs: sin esto, un valor que pasa
 * `class-validator` pero excede una columna sale como 500, que le dice al cliente "el server se
 * rompió" cuando el problema es suyo — y arruina cualquier alerta por tasa de 5xx.
 */
@Catch(QueryFailedError)
export class QueryFailedFilter implements ExceptionFilter<QueryFailedError> {
  constructor(
    private readonly httpAdapterHost: HttpAdapterHost,
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(QueryFailedFilter.name);
  }

  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const sqlstate = (exception.driverError as { code?: string } | undefined)
      ?.code;

    // El detalle de Postgres se loguea pero nunca se responde: el mensaje trae nombres de
    // columnas y, en las violaciones de unicidad, valores de otras filas.
    this.logger.error({ sqlstate, query: exception.query }, exception.message);

    const { status, message } = SQLSTATE_TO_RESPONSE[sqlstate ?? ''] ?? {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      message: 'Internal server error',
    };

    this.httpAdapterHost.httpAdapter.reply(
      host.switchToHttp().getResponse(),
      { statusCode: status, message },
      status,
    );
  }
}
