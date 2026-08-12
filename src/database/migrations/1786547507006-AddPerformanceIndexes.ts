import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Índices aditivos y no destructivos sobre el esquema existente (no se modifica ninguna
 * tabla/columna). Aceleran las queries repetidas de ValuationService:
 *  - cash disponible / tenencia: filtra orders por (userid, status) y (instrumentid, status).
 *  - último precio: busca en marketdata por instrumentid ordenando por date desc.
 */
export class AddPerformanceIndexes1786547507006 implements MigrationInterface {
  name = 'AddPerformanceIndexes1786547507006';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_orders_userid_status ON orders (userid, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_orders_instrumentid_status ON orders (instrumentid, status)`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketdata_instrumentid_date ON marketdata (instrumentid, date DESC)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_marketdata_instrumentid_date`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_orders_instrumentid_status`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS idx_orders_userid_status`);
  }
}
