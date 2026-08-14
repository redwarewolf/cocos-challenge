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
 * usuario. No sabe nada de BUY/SELL/CASH_IN/CASH_OUT: recibe una función `computeData` que calcula
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
   * La orden ya guardada de *ese usuario* con esa key se busca dos veces, y las dos hacen
   * falta por motivos distintos.
   *
   * El filtro por `userId` no es decorativo: la key la elige el cliente, así que dos usuarios
   * pueden mandar la misma y buscar solo por key devolvería la orden ajena.
   */
  async write(
    idempotencyKey: string | undefined,
    userId: number,
    computeData: (manager: EntityManager) => Promise<OrderData>,
  ): Promise<Order> {
    // Optimización: un reintento tardío —el caso común, el cliente no recibió la respuesta
    // original— se resuelve con un SELECT, sin encolarse detrás del advisory lock del usuario.
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

      // Garantía de correctitud, y por eso va acá adentro: si el request original todavía
      // estaba en vuelo, el chequeo de arriba no lo vio, pero el lock se libera recién al
      // commitear, así que para cuando este llega su fila ya es visible. Sin este lookup se
      // volvería a ejecutar `computeData`, que puede lanzar —el precio se movió y el
      // `amount` ya no alcanza para una acción— y devolver un 4xx por una orden que existe y
      // quedó FILLED.
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
