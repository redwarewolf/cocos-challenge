import { BadRequestException, ExecutionContext } from '@nestjs/common';
import { MAX_IDEMPOTENCY_KEY_LENGTH } from '../database/column-limits';
import { extractIdempotencyKey } from './idempotency-key.decorator';

describe('extractIdempotencyKey', () => {
  function contextoCon(
    headers: Record<string, string | string[] | undefined>,
  ): ExecutionContext {
    return {
      switchToHttp: () => ({ getRequest: () => ({ headers }) }),
    } as unknown as ExecutionContext;
  }

  it('devuelve undefined si no se mandó el header (es opcional)', () => {
    expect(extractIdempotencyKey(undefined, contextoCon({}))).toBeUndefined();
  });

  it.each([
    ['un UUID', '550e8400-e29b-41d4-a716-446655440000'],
    ['una key artesanal', 'retry-1'],
    ['con punto y dos puntos', 'orden.2024:07'],
    ['del largo máximo exacto', 'a'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH)],
  ])('acepta %s', (_descripcion, key) => {
    expect(
      extractIdempotencyKey(undefined, contextoCon({ 'idempotency-key': key })),
    ).toBe(key);
  });

  it(`rechaza una key de más de ${MAX_IDEMPOTENCY_KEY_LENGTH} caracteres`, () => {
    // Sin esto llega a orders.idempotencykey VARCHAR(255) y vuelve como 500.
    const key = 'a'.repeat(MAX_IDEMPOTENCY_KEY_LENGTH + 1);

    expect(() =>
      extractIdempotencyKey(undefined, contextoCon({ 'idempotency-key': key })),
    ).toThrow(BadRequestException);
  });

  it.each([
    ['vacía', ''],
    ['con espacios', 'retry 1'],
    ['con salto de línea', 'retry\n1'],
    ['con caracteres no ASCII', 'órden-1'],
  ])('rechaza una key %s', (_descripcion, key) => {
    expect(() =>
      extractIdempotencyKey(undefined, contextoCon({ 'idempotency-key': key })),
    ).toThrow(BadRequestException);
  });

  it('rechaza el header repetido, que Node entrega como array', () => {
    expect(() =>
      extractIdempotencyKey(
        undefined,
        contextoCon({ 'idempotency-key': ['uno', 'dos'] }),
      ),
    ).toThrow(BadRequestException);
  });
});
