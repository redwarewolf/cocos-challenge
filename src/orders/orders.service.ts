import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paginated } from '../common/dto/paginated-response.dto';
import { PAGE_SIZE } from '../config/config';
import { AdvisoryLock, LockNamespace } from '../database/advisory-lock';
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
import {
  CashOrderDto,
  CreateOrderDto,
  isCashOrder,
} from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { IdempotentOrderWriter } from './idempotent-order-writer';
import { OrderPricingService } from './order-pricing.service';

/** Un peso vale un peso: precio con el que se persiste todo movimiento de cash. */
const CASH_PRICE = 1;

@Injectable()
export class OrdersService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    @InjectRepository(Instrument)
    private readonly instrumentRepository: Repository<Instrument>,
    private readonly valuationService: ValuationService,
    private readonly orderPricing: OrderPricingService,
    private readonly idempotentOrderWriter: IdempotentOrderWriter,
    private readonly advisoryLock: AdvisoryLock,
  ) {}

  async create(dto: CreateOrderDto, idempotencyKey?: string): Promise<Order> {
    if ((dto.size === undefined) === (dto.amount === undefined)) {
      throw new BadRequestException(
        'Provide exactly one of "size" or "amount"',
      );
    }

    if (isCashOrder(dto)) {
      return this.createCashFromOrder(dto, idempotencyKey);
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

    return this.idempotentOrderWriter.write(
      idempotencyKey,
      dto.userId,
      async (manager) => {
        const price = await this.orderPricing.resolvePrice(dto, manager);
        const size = this.orderPricing.resolveSize(dto, price);
        const status = await this.orderPricing.resolveStatus(
          dto,
          size,
          price,
          manager,
        );

        return {
          userId: dto.userId,
          instrumentId: dto.instrumentId,
          side: dto.side,
          type: dto.type,
          size,
          price: price.toFixed(2),
          status,
        };
      },
    );
  }

  /**
   * Movimiento de cash pedido por `POST /orders`, con la forma de una orden. Los campos que solo
   * tienen sentido para BUY/SELL tienen un único valor posible acá —el instrumento MONEDA, MARKET
   * y precio 1—, así que se aceptan con ese valor y se rechazan con cualquier otro: un `CASH_IN`
   * sobre una acción, o a un precio que no sea 1, no describe nada que pueda existir.
   */
  private async createCashFromOrder(
    dto: CashOrderDto,
    idempotencyKey?: string,
  ): Promise<Order> {
    if (dto.type !== undefined && dto.type !== OrderType.MARKET) {
      throw new BadRequestException(
        'CASH_IN/CASH_OUT movements are always MARKET',
      );
    }
    if (dto.price !== undefined && dto.price !== CASH_PRICE) {
      throw new BadRequestException(
        `CASH_IN/CASH_OUT movements are always priced at ${CASH_PRICE}`,
      );
    }

    // Con precio 1, el monto y la cantidad son el mismo número, así que sirve cualquiera de los dos.
    const amount = (dto.amount ?? dto.size)!;
    if (!Number.isInteger(amount)) {
      throw new BadRequestException(
        'CASH_IN/CASH_OUT movements only accept whole pesos',
      );
    }

    if (dto.instrumentId !== undefined) {
      const cashInstrument = await this.valuationService.getCashInstrument();
      if (dto.instrumentId !== cashInstrument.id) {
        throw new BadRequestException(
          `CASH_IN/CASH_OUT movements only apply to the cash instrument (${cashInstrument.ticker})`,
        );
      }
    }

    return this.createCashMovement(
      { userId: dto.userId, side: dto.side, amount },
      idempotencyKey,
    );
  }

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

    return this.idempotentOrderWriter.write(
      idempotencyKey,
      dto.userId,
      async (manager) => {
        // Los depósitos siempre se llenan; los retiros solo si hay disponible suficiente
        // (mismo criterio que un SELL sin fondos: se persiste igual, como REJECTED).
        const status =
          dto.side === OrderSide.CASH_OUT &&
          dto.amount >
            (await this.valuationService.getBuyingPower(dto.userId, manager))
            ? OrderStatus.REJECTED
            : OrderStatus.FILLED;

        return {
          userId: dto.userId,
          instrumentId: cashInstrument.id,
          side: dto.side,
          type: OrderType.MARKET,
          size: dto.amount,
          price: CASH_PRICE.toFixed(2),
          status,
        };
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
      // El desempate por `id` no es cosmético: `datetime` no es único (se setea con
      // `new Date()`, y dos órdenes del mismo usuario pueden caer en el mismo
      // milisegundo). Sin un criterio total, Postgres no garantiza un orden estable
      // entre dos queries con distinto OFFSET, así que una fila empatada puede
      // repetirse en una página y faltar en la otra. `id` es único y monotónico.
      order: { datetime: 'DESC', id: 'DESC' },
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

    // El lock es por usuario, así que hay que saber de quién es la orden para poder tomarlo: eso
    // es todo lo que aporta la lectura de afuera. El estado se relee adentro, ya serializado
    // contra las demás escrituras del usuario, porque entre las dos lecturas puede cambiar.
    return this.advisoryLock.withLock(
      LockNamespace.USER,
      order.userId,
      async (manager) => {
        const orderRepository = manager.getRepository(Order);
        const locked = await orderRepository.findOne({
          where: { id: orderId },
        });
        if (!locked) {
          throw new NotFoundException(`Order ${orderId} not found`);
        }
        if (locked.status !== OrderStatus.NEW) {
          throw new BadRequestException(
            `Only orders with status NEW can be cancelled (current status: ${locked.status})`,
          );
        }
        locked.status = OrderStatus.CANCELLED;
        return orderRepository.save(locked);
      },
    );
  }
}
