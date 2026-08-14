import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Params } from 'nestjs-pino';
import { getConfig } from '../config/config';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Formato de un `x-request-id` aceptable: cubre UUIDs, W3C `traceparent`, ULID y nanoid.
 * El valor lo elige quien hace el request y termina en cada línea de log, así que un `\n`
 * ahí inyectaría líneas falsas indistinguibles de las reales.
 */
const VALID_REQUEST_ID = /^[\w-]{1,128}$/;

/**
 * ID de correlación del request: reusa el `x-request-id` entrante si tiene forma de id, y si
 * no genera un UUID. Va también en la respuesta, para que el cliente pueda cruzar sus logs
 * con los del server. Un header con formato inválido se descarta sin fallar el request.
 */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const existing = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof existing === 'string' && VALID_REQUEST_ID.test(existing)
      ? existing
      : randomUUID();
  res.setHeader(REQUEST_ID_HEADER, id);
  return id;
}

/**
 * Configuración de pino: nivel según `LOG_LEVEL`, `silent` en test para no ensuciar la salida
 * de la suite, y salida legible fuera de producción — en producción se emite JSON, que es lo
 * que ingesta una herramienta de logs.
 */
export function buildLoggerOptions(): Params {
  const isTest = process.env.NODE_ENV === 'test';
  const isProduction = process.env.NODE_ENV === 'production';

  return {
    pinoHttp: {
      level: isTest ? 'silent' : getConfig().logLevel,
      genReqId,
      transport: isProduction
        ? undefined
        : { target: 'pino-pretty', options: { singleLine: true } },
    },
  };
}
