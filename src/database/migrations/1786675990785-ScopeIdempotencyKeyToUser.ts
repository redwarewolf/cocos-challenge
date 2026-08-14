import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * La constraint original `uq_orders_idempotencykey` era UNIQUE global sobre la key sola,
 * así que dos usuarios distintos no podían usar la misma `Idempotency-Key`: el segundo
 * recibía la orden del primero, con userId, instrumento, size y precio ajenos. Una key la
 * elige el cliente (un UUID, pero también podría ser "retry-1"), así que la colisión entre
 * cuentas no es hipotética.
 *
 * La unicidad correcta es por usuario: la key identifica un intento *de ese usuario*.
 *
 * No se edita `AddOrdersIdempotencyKey` para arreglarlo: esa migración ya corrió contra la
 * base provista, y reescribir una migración aplicada deja el historial de esquema mintiendo
 * sobre lo que realmente pasó. Va una migración nueva, como cualquier otro cambio.
 */
export class ScopeIdempotencyKeyToUser1786675990785 implements MigrationInterface {
  name = 'ScopeIdempotencyKeyToUser1786675990785';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS uq_orders_idempotencykey`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD CONSTRAINT uq_orders_userid_idempotencykey UNIQUE (userid, idempotencykey)`,
    );
  }

  /**
   * Volver atrás puede fallar legítimamente: si mientras estuvo aplicada esta migración dos
   * usuarios usaron la misma key, la constraint global ya no se puede recrear. Es correcto
   * que falle ruidosamente en vez de borrar filas para que entre.
   */
  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS uq_orders_userid_idempotencykey`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD CONSTRAINT uq_orders_idempotencykey UNIQUE (idempotencykey)`,
    );
  }
}
