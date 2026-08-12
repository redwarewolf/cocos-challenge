import { IsIn, IsInt, IsPositive } from 'class-validator';
import { OrderSide } from '../../database/entities/order.entity';

export class CreateCashMovementDto {
  @IsInt()
  @IsPositive()
  userId: number;

  /** Solo movimientos de cash: CASH_IN (depósito) o CASH_OUT (retiro). */
  @IsIn([OrderSide.CASH_IN, OrderSide.CASH_OUT])
  side: OrderSide.CASH_IN | OrderSide.CASH_OUT;

  /** Monto en pesos, entero (misma convención que el resto de `orders.size`). */
  @IsInt()
  @IsPositive()
  amount: number;
}
