import { ApiProperty } from '@nestjs/swagger';
import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
  Max,
} from 'class-validator';
import { MAX_ORDER_PRICE, MAX_ORDER_SIZE } from '../../database/column-limits';
import { OrderSide, OrderType } from '../../database/entities/order.entity';

export class CreateOrderDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiProperty({ example: 34, description: 'id del instrumento (no MONEDA)' })
  @IsInt()
  @IsPositive()
  instrumentId: number;

  @ApiProperty({
    enum: [OrderSide.BUY, OrderSide.SELL],
    description:
      'Solo BUY/SELL: CASH_IN/CASH_OUT no se exponen por este endpoint (ver POST /orders/cash).',
  })
  @IsEnum(OrderSide)
  side: OrderSide;

  @ApiProperty({ enum: OrderType })
  @IsEnum(OrderType)
  type: OrderType;

  @ApiProperty({
    required: false,
    example: 10,
    description:
      'Cantidad exacta de acciones. Mutuamente excluyente con `amount`.',
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
      'Monto en pesos a invertir; se calcula `size = floor(amount / price)`. Mutuamente excluyente con `size`.',
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
      'Obligatorio para LIMIT. Ignorado para MARKET (se usa el último close).',
  })
  @IsOptional()
  @IsNumber()
  @IsPositive()
  @Max(MAX_ORDER_PRICE)
  price?: number;
}
