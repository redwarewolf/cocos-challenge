import { randomUUID } from 'crypto';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Params } from 'nestjs-pino';
import { getConfig } from '../config/config';

const REQUEST_ID_HEADER = 'x-request-id';

/**
 * ID de correlación por request (issue #9): reusa el `x-request-id` entrante si el
 * cliente/proxy ya mandó uno (para no cortar la trazabilidad end-to-end), si no genera
 * un UUID nuevo. Se devuelve también en la respuesta para que el cliente pueda
 * correlacionar sus propios logs con los del server.
 */
export function genReqId(req: IncomingMessage, res: ServerResponse): string {
  const existing = req.headers[REQUEST_ID_HEADER];
  const id =
    typeof existing === 'string' && existing.length > 0
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
