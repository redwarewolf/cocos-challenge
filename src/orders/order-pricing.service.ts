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

/**
 * Reglas de negocio de precio/tamaño/estado específicas de BUY/SELL — no las usan los
 * movimientos de cash (CASH_IN/CASH_OUT), que tienen
 * su propia regla mucho más simple, inline en OrdersService.createCashMovement.
 */
@Injectable()
export class OrderPricingService {
  constructor(private readonly valuationService: ValuationService) {}

  /**
   * Redondea a 2 decimales acá (no al guardar la orden): el precio que se usa para
   * calcular `size`/validar fondos debe ser el mismo que después se persiste, si no,
   * un LIMIT con más de 2 decimales (`@IsNumber()` no lo restringe) podría validarse
   * contra un precio y guardarse con otro ligeramente distinto.
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
      // Mensaje neutro respecto del lado de la operación: resolveSize es común a BUY y
      // SELL, así que hablar de "comprar" le daría a un SELL por monto un error que
      // describe otra operación.
      throw new BadRequestException(
        '"amount" is not enough for at least one share at the current price',
      );
    }
    return size;
  }

  async resolveStatus(
    dto: CreateOrderDto,
    size: number,
    price: number,
    manager: EntityManager,
  ): Promise<OrderStatus> {
    // Contra el poder de compra y la tenencia vendible, no contra el disponible liquidado:
    // las órdenes NEW ya comprometieron esos pesos y esas acciones aunque todavía no se
    // hayan ejecutado.
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
