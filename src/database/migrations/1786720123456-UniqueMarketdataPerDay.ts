import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * `marketdata` guarda el OHLC diario de cada instrumento, así que la clave natural es
 * `(instrumentid, date)`. Sin unicidad, dos filas del mismo día dejan indefinido cuál es "el
 * último precio": una orden podría ejecutarse contra una y el portfolio valuarse contra la otra.
 *
 * El índice único reemplaza a `idx_marketdata_instrumentid_date`, que cubría las mismas columnas
 * — un btree `(instrumentid, date)` sirve igual para `ORDER BY date DESC`, que Postgres resuelve
 * recorriéndolo hacia atrás.
 */
export class UniqueMarketdataPerDay1786720123456 implements MigrationInterface {
  name = 'UniqueMarketdataPerDay1786720123456';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS uq_marketdata_instrumentid_date ON marketdata (instrumentid, date)`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS idx_marketdata_instrumentid_date`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS idx_marketdata_instrumentid_date ON marketdata (instrumentid, date DESC)`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS uq_marketdata_instrumentid_date`,
    );
  }
}
