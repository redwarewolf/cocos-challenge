import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
  ValidateIf,
} from 'class-validator';
import { MAX_ORDER_PRICE, MAX_ORDER_SIZE } from '../../database/column-limits';
import { OrderSide, OrderType } from '../../database/entities/order.entity';

/** Un movimiento de cash con la forma de `POST /orders`, ya estrechado el `side`. */
export type CashOrderDto = CreateOrderDto & {
  side: OrderSide.CASH_IN | OrderSide.CASH_OUT;
};

export function isCashOrder(dto: CreateOrderDto): dto is CashOrderDto {
  return dto.side === OrderSide.CASH_IN || dto.side === OrderSide.CASH_OUT;
}

/**
 * Body de `POST /orders`, que acepta los cuatro sides. Las reglas dependen del side, así que cada
 * campo que solo aplica a BUY/SELL se valida condicionalmente: acá se resuelve si el campo tiene
 * que estar y de qué tipo, y la coherencia de su valor se valida en `OrdersService` (es cruzada
 * entre campos, y en el caso del instrumento hace falta ir a la base).
 */
export class CreateOrderDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiProperty({
    required: false,
    example: 34,
    description:
      'Obligatorio para BUY/SELL. En CASH_IN/CASH_OUT es opcional, y si viene tiene que ser el instrumento MONEDA.',
  })
  @ValidateIf(
    (dto: CreateOrderDto) =>
      !isCashOrder(dto) || dto.instrumentId !== undefined,
  )
  @IsInt()
  @IsPositive()
  instrumentId: number;

  @ApiProperty({
    enum: OrderSide,
    description:
      'BUY/SELL operan un instrumento; CASH_IN/CASH_OUT depositan o retiran pesos (equivalen a POST /orders/cash).',
  })
  @IsEnum(OrderSide)
  side: OrderSide;

  @ApiProperty({
    enum: OrderType,
    required: false,
    description:
      'Obligatorio para BUY/SELL. En CASH_IN/CASH_OUT es opcional, y si viene tiene que ser MARKET.',
  })
  @ValidateIf(
    (dto: CreateOrderDto) => !isCashOrder(dto) || dto.type !== undefined,
  )
  @IsEnum(OrderType)
  type: OrderType;

  @ApiProperty({
    required: false,
    example: 10,
    description:
      'Cantidad exacta de acciones, o el monto en pesos si el side es de cash. Mutuamente excluyente con `amount`.',
  })
  @IsOptional()
  @IsInt()
  @IsPositive()
  @Max(MAX_ORDER_SIZE)
  size?: number;

  @ApiProperty({
    required: false,
    example: 5000,
    description:
      'Monto en pesos a invertir; se calcula `size = floor(amount / price)`. En un movimiento de cash es el monto a depositar o retirar, y tiene que ser entero. Mutuamente excluyente con `size`.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(MAX_ORDER_PRICE)
  amount?: number;

  @ApiProperty({
    required: false,
    example: 700,
    description:
      'Obligatorio para LIMIT. Ignorado para MARKET (se usa el último close). En CASH_IN/CASH_OUT, si viene tiene que ser 1.',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(MAX_ORDER_PRICE)
  price?: number;
}
