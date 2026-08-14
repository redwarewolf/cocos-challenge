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

/** Datos de una orden/movimiento a punto de persistirse, sin `idempotencyKey` todavía
 * (la agrega `IdempotentOrderWriter` internamente). */
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
 * Persiste una orden/movimiento de forma idempotente y protegida por el advisory lock del
 * usuario (issue #35, extraído de OrdersService — antes `createWithIdempotency`/`saveOrder`).
 * No sabe nada de BUY/SELL/CASH_IN/CASH_OUT: recibe una función `computeData` que calcula
 * los campos de la orden (bajo el lock, con acceso al `manager` transaccional) y se encarga
 * de la idempotencia y la concurrencia alrededor de eso.
 */
@Injectable()
export class IdempotentOrderWriter {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    private readonly advisoryLock: AdvisoryLock,
  ) {}

  /**
   * Si viene `idempotencyKey`, se busca primero una orden ya guardada de *ese usuario* con
   * esa key — caso común, el cliente reintentó un POST después de un timeout sin haber
   * recibido la respuesta original. El filtro por `userId` no es decorativo: la key la elige
   * el cliente, así que dos usuarios pueden mandar la misma y buscar solo por key devolvería
   * la orden ajena. Si existe, se devuelve directamente, sin tomar el lock ni volver a
   * calcular nada. Si no existe, se ejecuta `computeData` bajo el advisory lock de siempre
   * (ver `saveOrder` para cómo se resuelve la carrera rara de dos requests con la misma key
   * llegando casi al mismo tiempo).
   */
  async write(
    idempotencyKey: string | undefined,
    userId: number,
    computeData: (manager: EntityManager) => Promise<OrderData>,
  ): Promise<Order> {
    if (idempotencyKey) {
      const existing = await this.orderRepository.findOne({
        where: { userId, idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    return this.advisoryLock.withLock(userId, async (manager) => {
      const data = await computeData(manager);
      return this.saveOrder(manager, {
        ...data,
        idempotencyKey: idempotencyKey ?? null,
      });
    });
  }

  /**
   * Sin `idempotencyKey`, un `save()` normal alcanza (nunca puede chocar contra la
   * constraint UNIQUE, que ignora los `NULL`). Con `idempotencyKey`, se inserta con
   * `ON CONFLICT DO NOTHING` (vía `.orIgnore()`) en vez de un `INSERT` liso: si dos
   * requests con la misma key llegan casi al mismo tiempo, la que pierde la carrera no
   * falla, simplemente no inserta nada. En ambos casos —ganamos o perdimos la carrera— la
   * fila de ese usuario con esa key ya existe en la DB después del insert, así que un
   * `findOne` la resuelve sin necesidad de inspeccionar códigos de error.
   *
   * `.orIgnore()` genera un `ON CONFLICT DO NOTHING` sin target, así que sigue funcionando
   * igual contra la constraint compuesta `(userid, idempotencykey)`.
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

    const order = await orderRepo.findOne({
      where: { userId: data.userId, idempotencyKey: data.idempotencyKey },
    });
    if (!order) {
      throw new Error(
        `No se pudo crear ni encontrar la orden con Idempotency-Key ${data.idempotencyKey}`,
      );
    }
    return order;
  }
}
