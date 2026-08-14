import { Injectable, BadRequestException } from '@nestjs/common';
import Decimal from 'decimal.js';
import { EntityManager } from 'typeorm';
import { MAX_ORDER_SIZE } from '../database/column-limits';
import { ValuationService } from '../valuation/valuation.service';
import { CreateOrderDto } from './dto/create-order.dto';
import {
  OrderSide,
  OrderStatus,
  OrderType,
} from '../database/entities/order.entity';

/** Resuelve precio, tamaño y estado de una orden BUY/SELL a partir del request. */
@Injectable()
export class OrderPricingService {
  constructor(private readonly valuationService: ValuationService) {}

  /**
   * Precio de ejecución: el último cierre para MARKET, el del request para LIMIT. Se redondea
   * a la escala de la columna acá, para validar contra el mismo precio que se va a persistir.
   */
  async resolvePrice(
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

  /** Cantidad de acciones: la del request, o las que entran enteras en `amount` al precio dado. */
  resolveSize(dto: CreateOrderDto, price: number): number {
    if (dto.size !== undefined) {
      return dto.size;
    }
    const size = new Decimal(dto.amount!).dividedBy(price).floor().toNumber();
    // El techo de `amount` no alcanza para acotar esto: con un precio suficientemente bajo,
    // un monto válido da un size que no entra en `orders.size`.
    if (size > MAX_ORDER_SIZE) {
      throw new BadRequestException(
        `"amount" resolves to more than ${MAX_ORDER_SIZE} shares at the current price`,
      );
    }
    if (size < 1) {
      throw new BadRequestException(
        '"amount" is not enough for at least one share at the current price',
      );
    }
    return size;
  }

  /**
   * Estado con el que nace la orden: REJECTED si el disponible no alcanza, y si alcanza
   * FILLED cuando es MARKET o NEW cuando es LIMIT.
   */
  async resolveStatus(
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
              await this.valuationService.getBuyingPower(dto.userId, manager),
            )
        : size <=
          (await this.valuationService.getSellableQuantity(
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
