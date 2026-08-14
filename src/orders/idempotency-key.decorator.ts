import {
  BadRequestException,
  ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import type { IncomingMessage } from 'http';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '../database/column-limits';

/**
 * El valor lo elige el cliente y se persiste en `orders.idempotencykey VARCHAR(255)`, así que
 * un valor más largo llega a la base y vuelve como 500. Los caracteres se acotan por el mismo
 * motivo que en el `x-request-id` (ver logging/logger.config.ts): es un identificador opaco,
 * no texto libre.
 */
const VALID_KEY = new RegExp(`^[\\w.:-]{1,${MAX_IDEMPOTENCY_KEY_LENGTH}}$`);

/**
 * A diferencia de `@Param`/`@Query`, `@Headers()` no acepta pipes, así que la validación vive
 * acá. Se exporta con la firma que espera `createParamDecorator` para poder pasarla directo y
 * testearla sin levantar un contexto HTTP.
 */
export function extractIdempotencyKey(
  _data: unknown,
  ctx: ExecutionContext,
): string | undefined {
  const raw = ctx.switchToHttp().getRequest<IncomingMessage>().headers[
    'idempotency-key'
  ];
  if (raw === undefined) {
    return undefined;
  }
  if (typeof raw !== 'string' || !VALID_KEY.test(raw)) {
    throw new BadRequestException(
      `Idempotency-Key must be 1-${MAX_IDEMPOTENCY_KEY_LENGTH} characters of [A-Za-z0-9_.:-]`,
    );
  }
  return raw;
}

export const IdempotencyKey = createParamDecorator(extractIdempotencyKey);
