import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import { AdvisoryLock } from '../database/advisory-lock';
import {
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
} from '../database/entities/order.entity';

export interface OrderData {
  userId: number;
  instrumentId: number;
  side: OrderSide;
  type: OrderType;
  size: number;
  price: string;
  status: OrderStatus;
}

/**
 * Persiste una orden de forma idempotente y serializada por usuario. No sabe qué tipo de orden
 * persiste: recibe una `computeData` que calcula los campos bajo el lock.
 */
@Injectable()
export class IdempotentOrderWriter {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly advisoryLock: AdvisoryLock,
  ) {}

  /**
   * Upsert de una orden para un usuario: si ya existe una con esa `idempotencyKey` la devuelve, y
   * si no la calcula con `computeData` y la inserta, serializado por el advisory lock del usuario.
   *
   * La búsqueda corre dos veces, antes y dentro del lock: el lock se libera al commitear, así que
   * una orden que se está escribiendo en paralelo recién es visible adentro.
   */
  async write(
    idempotencyKey: string | undefined,
    userId: number,
    computeData: (manager: EntityManager) => Promise<OrderData>,
  ): Promise<Order> {
    if (idempotencyKey) {
      const existing = await this.findByKey(
        this.orderRepository,
        userId,
        idempotencyKey,
      );
      if (existing) {
        return existing;
      }
    }

    return this.advisoryLock.withLock(userId, async (manager) => {
      const orderRepo = manager.getRepository(Order);

      if (idempotencyKey) {
        const existing = await this.findByKey(
          orderRepo,
          userId,
          idempotencyKey,
        );
        if (existing) {
          return existing;
        }
      }

      const data = await computeData(manager);
      return this.saveOrder(manager, {
        ...data,
        idempotencyKey: idempotencyKey ?? null,
      });
    });
  }

  private findByKey(
    repo: Repository<Order>,
    userId: number,
    idempotencyKey: string,
  ): Promise<Order | null> {
    return repo.findOne({ where: { userId, idempotencyKey } });
  }

  /**
   * Con key, `.orIgnore()` genera un `ON CONFLICT DO NOTHING` sin target, que por eso cubre la
   * constraint compuesta `(userid, idempotencykey)`: el que pierde la carrera no falla, no
   * inserta, y relee la fila del que ganó. Sin key alcanza un `save()`, porque la UNIQUE
   * ignora los `NULL`.
   */
  private async saveOrder(
    manager: EntityManager,
    data: OrderData & { idempotencyKey: string | null },
  ): Promise<Order> {
    const orderRepo = manager.getRepository(Order);
    const withDatetime = { ...data, datetime: new Date() };

    if (!data.idempotencyKey) {
      return orderRepo.save(orderRepo.create(withDatetime));
    }

    await manager
      .createQueryBuilder()
      .insert()
      .into(Order)
      .values(withDatetime)
      .orIgnore()
      .execute();

    const order = await this.findByKey(
      orderRepo,
      data.userId,
      data.idempotencyKey,
    );
    if (!order) {
      throw new Error(
        `No se pudo crear ni encontrar la orden con Idempotency-Key ${data.idempotencyKey}`,
      );
    }
    return order;
  }
}
