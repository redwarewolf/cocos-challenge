import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Columna aditiva (issue #8): soporte de idempotencia para POST /orders y
 * POST /orders/cash vía header `Idempotency-Key`. Nullable — la gran mayoría de las
 * filas no la van a tener, solo se completa cuando el cliente manda el header. La
 * constraint UNIQUE es lo que hace atómica la detección de duplicados a nivel DB
 * (dos NULLs nunca "chocan" entre sí en Postgres, así que no afecta a las filas sin key).
 */
export class AddOrdersIdempotencyKey1786632463101 implements MigrationInterface {
  name = 'AddOrdersIdempotencyKey1786632463101';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders ADD COLUMN IF NOT EXISTS idempotencykey VARCHAR(255)`,
    );
    await queryRunner.query(
      `ALTER TABLE orders ADD CONSTRAINT uq_orders_idempotencykey UNIQUE (idempotencykey)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE orders DROP CONSTRAINT IF EXISTS uq_orders_idempotencykey`,
    );
    await queryRunner.query(
      `ALTER TABLE orders DROP COLUMN IF EXISTS idempotencykey`,
    );
  }
}
