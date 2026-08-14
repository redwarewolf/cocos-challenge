import {
  BadRequestException,
  ExecutionContext,
  createParamDecorator,
} from '@nestjs/common';
import type { IncomingMessage } from 'http';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '../database/column-limits';

/** Formato de key aceptable: un identificador opaco, acotado al largo de la columna. */
const VALID_KEY = new RegExp(`^[\\w.:-]{1,${MAX_IDEMPOTENCY_KEY_LENGTH}}$`);

/**
 * Lee y valida el header `Idempotency-Key`, devolviendo `undefined` si no vino. La validación
 * vive acá porque `@Headers()`, a diferencia de `@Param`/`@Query`, no acepta pipes.
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
