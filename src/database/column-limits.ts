/**
 * Techos que impone el esquema, para validarlos en el borde en vez de dejar que los rechace
 * Postgres: un input fuera de rango tiene que ser un 400, no el 500 que sale de un
 * `QueryFailedError` sin atrapar.
 */

/** `orders.size` es `INT`. */
export const MAX_ORDER_SIZE = 2_147_483_647;

/** `orders.price` es `NUMERIC(10, 2)`. */
export const MAX_ORDER_PRICE = 99_999_999.99;

/** `orders.idempotencykey` es `VARCHAR(255)`. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
