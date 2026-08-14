import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Params } from 'nestjs-pino';
import { getConfig } from '../config/config';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * Formato aceptado para un `x-request-id` entrante: alfanumérico, guiones y guiones bajos,
 * hasta 128 caracteres. Cubre UUIDs y los formatos de trace id habituales (W3C
 * `traceparent`, ULID, nanoid).
 *
 * El valor entrante lo controla quien hace el request y termina en cada línea de log, así
 * que no puede usarse crudo. Lo grave no es el largo sino los caracteres de control: un
 * `\n` en el header inyecta líneas falsas en la salida de logs, indistinguibles de las
 * reales para quien después las lee o las parsea. El cap de largo evita, además, que un
 * header de 100 KB se replique en cada línea del request.
 */
const VALID_REQUEST_ID = /^[\w-]{1,128}$/;

/**
 * ID de correlación por request: reusa el `x-request-id` entrante si el
 * cliente/proxy ya mandó uno **y tiene forma de id** (para no cortar la trazabilidad
 * end-to-end), si no genera un UUID nuevo. Se devuelve también en la respuesta para que el
 * cliente pueda correlacionar sus propios logs con los del server.
 *
 * Un header inválido se descarta en silencio, sin error: el cliente no pidió nada mal, y
 * fallar el request por un header de observabilidad sería peor que ignorarlo.
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
 * Factory (no un objeto estático, mismo motivo que `buildDataSourceOptions`): el nivel
 * depende de `LOG_LEVEL`, que se resuelve recién al bootear la app. En test
 * (`NODE_ENV=test`, lo fija Jest solo) el logger queda en `silent` sin importar
 * `LOG_LEVEL`, para no ensuciar la salida de `npm test`/`npm run test:e2e`. Formato
 * "pretty" (legible) solo fuera de producción — Docker corre con `NODE_ENV=production`
 * (ver Dockerfile) — porque en producción interesa JSON parseable por una herramienta de
 * logs, no texto formateado a mano.
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
