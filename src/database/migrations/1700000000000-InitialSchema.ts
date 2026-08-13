import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Versiona el esquema base que Cocos ya provisionó en la Neon real (mismo
 * `CREATE TABLE` que `database.sql` del challenge, columnas sin quotear así que
 * Postgres las guarda en minúsculas). Timestamp anterior a todas las demás
 * migraciones a propósito, para que corra primero si algún día se aplica el
 * historial completo contra una base vacía.
 *
 * Usa `IF NOT EXISTS` porque contra la Neon real las tablas ya existen — acá es
 * un no-op seguro (documenta el esquema, no lo recrea) — y porque no se incluye
 * el seed de datos: el de Cocos ya está cargado en Neon, y el de los tests e2e
 * es uno propio, más chico y determinístico (ver test/setup/seed.sql), corrido
 * aparte después de las migraciones, no como parte de ellas.
 */
export class InitialSchema1700000000000 implements MigrationInterface {
  name = 'InitialSchema1700000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        email VARCHAR(255),
        accountNumber VARCHAR(20)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS instruments (
        id SERIAL PRIMARY KEY,
        ticker VARCHAR(10),
        name VARCHAR(255),
        type VARCHAR(10)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS orders (
        id SERIAL PRIMARY KEY,
        instrumentId INT,
        userId INT,
        size INT,
        price NUMERIC(10, 2),
        type VARCHAR(10),
        side VARCHAR(10),
        status VARCHAR(20),
        datetime TIMESTAMP,
        FOREIGN KEY (instrumentId) REFERENCES instruments(id),
        FOREIGN KEY (userId) REFERENCES users(id)
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS marketdata (
        id SERIAL PRIMARY KEY,
        instrumentId INT,
        high NUMERIC(10, 2),
        low NUMERIC(10, 2),
        open NUMERIC(10, 2),
        close NUMERIC(10, 2),
        previousClose NUMERIC(10, 2),
        date DATE,
        FOREIGN KEY (instrumentId) REFERENCES instruments(id)
      )
    `);
  }

  public down(): Promise<void> {
    // A propósito no revierte: un DROP TABLE acá borraría los datos reales de
    // Cocos en Neon si alguien corriera `migration:revert` sin pensarlo. Si hace
    // falta revertir el esquema base alguna vez, es una decisión manual, no
    // automatizable de forma segura.
    throw new Error(
      'InitialSchema no se revierte automáticamente (borraría datos reales de la DB de Cocos). ' +
        'Si hace falta, hacerlo a mano y con cuidado.',
    );
  }
}
