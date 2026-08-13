import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Paginated } from '../common/dto/paginated-response.dto';
import { PAGE_SIZE } from '../config/config';
import {
  Instrument,
  InstrumentType,
} from '../database/entities/instrument.entity';
import {
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
} from '../database/entities/order.entity';
import { User } from '../database/entities/user.entity';
import { ValuationService } from '../valuation/valuation.service';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Instrument)
    private readonly instrumentRepository: Repository<Instrument>,
    private readonly valuationService: ValuationService,
    @InjectDataSource() private readonly dataSource: DataSource,
  ) {}

  async create(dto: CreateOrderDto, idempotencyKey?: string): Promise<Order> {
    if (dto.side !== OrderSide.BUY && dto.side !== OrderSide.SELL) {
      throw new BadRequestException(
        'side must be BUY or SELL for this endpoint',
      );
    }
    if ((dto.size === undefined) === (dto.amount === undefined)) {
      throw new BadRequestException(
        'Provide exactly one of "size" or "amount"',
      );
    }
    if (dto.type === OrderType.LIMIT && dto.price === undefined) {
      throw new BadRequestException('"price" is required for LIMIT orders');
    }

    const user = await this.userRepository.findOne({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`User ${dto.userId} not found`);
    }

    const instrument = await this.instrumentRepository.findOne({
      where: { id: dto.instrumentId },
    });
    if (!instrument) {
      throw new NotFoundException(`Instrument ${dto.instrumentId} not found`);
    }
    if (instrument.type === InstrumentType.MONEDA) {
      throw new BadRequestException(
        'Cannot place BUY/SELL orders on the cash instrument',
      );
    }

    return this.createWithIdempotency(
      idempotencyKey,
      dto.userId,
      async (manager) => {
        const price = await this.resolvePrice(dto, manager);
        const size = this.resolveSize(dto, price);
        const status = await this.resolveStatus(dto, size, price, manager);

        return this.saveOrder(manager, {
          userId: dto.userId,
          instrumentId: dto.instrumentId,
          side: dto.side,
          type: dto.type,
          size,
          price: price.toFixed(2),
          status,
          idempotencyKey: idempotencyKey ?? null,
        });
      },
    );
  }

  /** Deposita (CASH_IN) o retira (CASH_OUT) pesos de la cuenta del usuario. */
  async createCashMovement(
    dto: CreateCashMovementDto,
    idempotencyKey?: string,
  ): Promise<Order> {
    const user = await this.userRepository.findOne({
      where: { id: dto.userId },
    });
    if (!user) {
      throw new NotFoundException(`User ${dto.userId} not found`);
    }

    const cashInstrument = await this.valuationService.getCashInstrument();

    return this.createWithIdempotency(
      idempotencyKey,
      dto.userId,
      async (manager) => {
        // Los depósitos siempre se llenan; los retiros solo si hay disponible suficiente
        // (mismo criterio que un SELL sin fondos: se persiste igual, como REJECTED).
        const status =
          dto.side === OrderSide.CASH_OUT &&
          dto.amount >
            (await this.valuationService.getAvailableCash(dto.userId, manager))
            ? OrderStatus.REJECTED
            : OrderStatus.FILLED;

        return this.saveOrder(manager, {
          userId: dto.userId,
          instrumentId: cashInstrument.id,
          side: dto.side,
          type: OrderType.MARKET,
          size: dto.amount,
          price: (1).toFixed(2),
          status,
          idempotencyKey: idempotencyKey ?? null,
        });
      },
    );
  }

  /** Historial de órdenes/movimientos de un usuario, más recientes primero. */
  async findAll(query: ListOrdersQueryDto): Promise<Paginated<Order>> {
    const user = await this.userRepository.findOne({
      where: { id: query.userId },
    });
    if (!user) {
      throw new NotFoundException(`User ${query.userId} not found`);
    }

    const page = query.page ?? 1;
    const limit = query.limit ?? PAGE_SIZE;

    const where: { userId: number; status?: OrderStatus } = {
      userId: query.userId,
    };
    if (query.status) {
      where.status = query.status;
    }

    const [data, total] = await this.orderRepository.findAndCount({
      where,
      order: { datetime: 'DESC' },
      skip: (page - 1) * limit,
      take: limit,
    });

    return { data, total, page, limit };
  }

  async cancel(orderId: number): Promise<Order> {
    const order = await this.orderRepository.findOne({
      where: { id: orderId },
    });
    if (!order) {
      throw new NotFoundException(`Order ${orderId} not found`);
    }
    if (order.status !== OrderStatus.NEW) {
      throw new BadRequestException(
        `Only orders with status NEW can be cancelled (current status: ${order.status})`,
      );
    }
    order.status = OrderStatus.CANCELLED;
    return this.orderRepository.save(order);
  }

  /**
   * Idempotencia (issue #8): si viene `idempotencyKey`, se busca primero una orden ya
   * guardada con esa key — caso común, el cliente reintentó un POST después de un
   * timeout sin haber recibido la respuesta original. Si existe, se devuelve
   * directamente, sin tomar el lock ni recalcular nada. Si no existe, se ejecuta
   * `work` bajo el advisory lock de siempre (ver `saveOrder` para cómo se resuelve
   * la carrera rara de dos requests con la misma key llegando casi al mismo tiempo).
   */
  private async createWithIdempotency(
    idempotencyKey: string | undefined,
    userId: number,
    work: (manager: EntityManager) => Promise<Order>,
  ): Promise<Order> {
    if (idempotencyKey) {
      const existing = await this.orderRepository.findOne({
        where: { idempotencyKey },
      });
      if (existing) {
        return existing;
      }
    }

    return this.withUserLock(userId, work);
  }

  /**
   * Advisory lock transaccional por usuario: serializa toda creación de movimientos de
   * este usuario (órdenes BUY/SELL o cash CASH_IN/CASH_OUT). Sin esto, dos requests
   * concurrentes podrían leer el mismo "disponible" (cash o tenencia) antes de que
   * ninguno se hubiera guardado, pasar la validación los dos, y terminar gastando más
   * pesos o vendiendo más acciones de las que el usuario realmente tiene (race
   * check-then-act / "doble gasto"). Se libera solo al commitear/rollbackear la
   * transacción, y no bloquea a otros usuarios (la key es el userId).
   */
  private async withUserLock<T>(
    userId: number,
    fn: (manager: EntityManager) => Promise<T>,
  ): Promise<T> {
    return this.dataSource.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock($1)', [userId]);
      return fn(manager);
    });
  }

  /**
   * Sin `idempotencyKey`, un `save()` normal alcanza (nunca puede chocar contra la
   * constraint UNIQUE, que ignora los `NULL`). Con `idempotencyKey`, se inserta con
   * `ON CONFLICT DO NOTHING` (vía `.orIgnore()`) en vez de un `INSERT` liso: si dos
   * requests con la misma key llegan casi al mismo tiempo, la que pierde la carrera
   * no falla, simplemente no inserta nada. En ambos casos —ganamos o perdimos la
   * carrera— la fila con esa key ya existe en la DB después del insert, así que un
   * `findOne` la resuelve sin necesidad de inspeccionar códigos de error.
   */
  private async saveOrder(
    manager: EntityManager,
    data: Pick<
      Order,
      | 'userId'
      | 'instrumentId'
      | 'side'
      | 'type'
      | 'size'
      | 'price'
      | 'status'
      | 'idempotencyKey'
    >,
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
      where: { idempotencyKey: data.idempotencyKey },
    });
    if (!order) {
      throw new Error(
        `No se pudo crear ni encontrar la orden con Idempotency-Key ${data.idempotencyKey}`,
      );
    }
    return order;
  }

  /**
   * Redondea a 2 decimales acá (no al guardar la orden): el precio que se usa para
   * calcular `size`/validar fondos debe ser el mismo que después se persiste, si no,
   * un LIMIT con más de 2 decimales (`@IsNumber()` no lo restringe) podría validarse
   * contra un precio y guardarse con otro ligeramente distinto.
   */
  private async resolvePrice(
    dto: CreateOrderDto,
    manager: EntityManager,
  ): Promise<number> {
    if (dto.type === OrderType.LIMIT) {
      return new Decimal(dto.price!).toDecimalPlaces(2).toNumber();
    }
    const lastClose = await this.valuationService.getLastClose(
      dto.instrumentId,
      manager,
    );
    if (lastClose === null) {
      throw new BadRequestException(
        'No market data available for this instrument',
      );
    }
    return lastClose;
  }

  private resolveSize(dto: CreateOrderDto, price: number): number {
    if (dto.size !== undefined) {
      return dto.size;
    }
    const size = new Decimal(dto.amount!).dividedBy(price).floor().toNumber();
    if (size < 1) {
      throw new BadRequestException(
        '"amount" is not enough to buy at least one share at the current price',
      );
    }
    return size;
  }

  private async resolveStatus(
    dto: CreateOrderDto,
    size: number,
    price: number,
    manager: EntityManager,
  ): Promise<OrderStatus> {
    const hasEnoughFunds =
      dto.side === OrderSide.BUY
        ? new Decimal(size)
            .times(price)
            .lessThanOrEqualTo(
              await this.valuationService.getAvailableCash(dto.userId, manager),
            )
        : size <=
          (await this.valuationService.getAvailableQuantity(
            dto.userId,
            dto.instrumentId,
            manager,
          ));

    if (!hasEnoughFunds) {
      return OrderStatus.REJECTED;
    }
    return dto.type === OrderType.MARKET ? OrderStatus.FILLED : OrderStatus.NEW;
  }
}
