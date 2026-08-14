import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Advisory lock transaccional de Postgres: serializa un leer-y-luego-escribir por una key
 * numérica, sin bloquear a quienes usan otra key.
 */
@Injectable()
export class AdvisoryLock {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Corre `fn` con el lock de `key` tomado, dentro de una transacción. El lock se libera al
   * commitear o rollbackear, no antes.
   */
  async withLock<T>(
    key: number,
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [key]);
      return fn(manager);
    });
  }
}
