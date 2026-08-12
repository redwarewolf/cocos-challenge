import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
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

    const price = await this.resolvePrice(dto);
    const size = this.resolveSize(dto, price);
    const status = await this.resolveStatus(dto, size, price);

    const order = this.orderRepository.create({
      userId: dto.userId,
      instrumentId: dto.instrumentId,
      side: dto.side,
      type: dto.type,
      size,
      price: price.toFixed(2),
      status,
      datetime: new Date(),
    });

    return this.orderRepository.save(order);
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

  private async resolvePrice(dto: CreateOrderDto): Promise<number> {
    if (dto.type === OrderType.LIMIT) {
      return dto.price!;
    }
    const lastClose = await this.valuationService.getLastClose(
      dto.instrumentId,
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
  ): Promise<OrderStatus> {
    const hasEnoughFunds =
      dto.side === OrderSide.BUY
        ? size * price <=
          (await this.valuationService.getAvailableCash(dto.userId))
        : size <=
          (await this.valuationService.getAvailableQuantity(
            dto.userId,
            dto.instrumentId,
          ));

    if (!hasEnoughFunds) {
      return OrderStatus.REJECTED;
    }
    return dto.type === OrderType.MARKET ? OrderStatus.FILLED : OrderStatus.NEW;
  }
}
