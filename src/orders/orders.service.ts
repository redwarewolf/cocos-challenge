import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
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
import { CreateOrderDto } from './dto/create-order.dto';

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

  async create(dto: CreateOrderDto): Promise<Order> {
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

    return this.dataSource.transaction(async (manager) => {
      // Advisory lock transaccional por usuario: serializa toda creación de órdenes de
      // este usuario (BUY o SELL, cualquier instrumento). Sin esto, dos órdenes
      // concurrentes podrían leer el mismo "disponible" (cash o tenencia) antes de que
      // ninguna se hubiera guardado, pasar la validación las dos, y terminar gastando
      // más pesos o vendiendo más acciones de las que el usuario realmente tiene
      // (race check-then-act / "doble gasto"). Se libera solo al commitear/rollbackear
      // esta transacción, y no bloquea a otros usuarios (la key es el userId).
      await manager.query('SELECT pg_advisory_xact_lock($1)', [dto.userId]);

      const price = await this.resolvePrice(dto, manager);
      const size = this.resolveSize(dto, price);
      const status = await this.resolveStatus(dto, size, price, manager);

      const orderRepo = manager.getRepository(Order);
      const order = orderRepo.create({
        userId: dto.userId,
        instrumentId: dto.instrumentId,
        side: dto.side,
        type: dto.type,
        size,
        price: price.toFixed(2),
        status,
        datetime: new Date(),
      });

      return orderRepo.save(order);
    });
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

  private async resolvePrice(
    dto: CreateOrderDto,
    manager: EntityManager,
  ): Promise<number> {
    if (dto.type === OrderType.LIMIT) {
      return dto.price!;
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
    const size = Math.floor(dto.amount! / price);
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
        ? size * price <=
          (await this.valuationService.getAvailableCash(dto.userId, manager))
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
