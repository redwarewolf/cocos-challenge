import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Qué identifica la key del lock. Postgres tiene un único espacio de advisory locks, así que sin
 * un namespace el usuario 5 y el instrumento 5 se serializarían entre sí sin tener nada que ver.
 */
export enum LockNamespace {
  USER = 1,
}

/**
 * Advisory lock transaccional de Postgres: serializa un leer-y-luego-escribir por una key
 * numérica, sin bloquear a quienes usan otra key.
 */
@Injectable()
export class AdvisoryLock {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  /**
   * Corre `fn` con el lock de `(namespace, key)` tomado, dentro de una transacción. El lock se
   * libera al commitear o rollbackear, no antes.
   */
  async withLock<T>(
    namespace: LockNamespace,
    key: number,
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1, $2)', [
        namespace,
        key,
      ]);
      return fn(manager);
    });
  }
}
