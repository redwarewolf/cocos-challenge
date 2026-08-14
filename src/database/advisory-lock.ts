import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';

/**
 * Advisory lock transaccional de Postgres:
 * serializa cualquier lógica que necesite leer-y-luego-escribir de forma segura por una
 * key numérica (ej. un `userId`), sin bloquear a quienes usan una key distinta. Se libera
 * solo al commitear/rollbackear la transacción. No es específico de órdenes — es un
 * primitivo de concurrencia genérico, reusable por cualquier feature futura que necesite
 * el mismo patrón de serialización por key.
 */
@Injectable()
export class AdvisoryLock {
  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

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
