import {
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsPositive,
} from 'class-validator';
import { OrderSide, OrderType } from '../../database/entities/order.entity';

export class CreateOrderDto {
  @IsInt()
  @IsPositive()
  userId: number;

  @IsInt()
  @IsPositive()
  instrumentId: number;

  /** Solo BUY/SELL: CASH_IN/CASH_OUT no se exponen por este endpoint (ver README). */
  @IsEnum(OrderSide)
  side: OrderSide;

  @IsEnum(OrderType)
  type: OrderType;

  /** Cantidad exacta de acciones. Mutuamente excluyente con `amount`. */
  @IsOptional()
  @IsInt()
  @IsPositive()
  size?: number;

  /** Monto en pesos a invertir; se calcula `size = floor(amount / price)`. Mutuamente excluyente con `size`. */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  amount?: number;

  /** Obligatorio para LIMIT. Ignorado para MARKET (se usa el último close). */
  @IsOptional()
  @IsNumber()
  @IsPositive()
  price?: number;
}
