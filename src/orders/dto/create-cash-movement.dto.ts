import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsPositive, Max } from 'class-validator';
import { MAX_ORDER_SIZE } from '../../database/column-limits';
import { OrderSide } from '../../database/entities/order.entity';

export class CreateCashMovementDto {
  @ApiProperty({ example: 1 })
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiProperty({
    enum: [OrderSide.CASH_IN, OrderSide.CASH_OUT],
    description: 'CASH_IN (depósito) o CASH_OUT (retiro).',
  })
  @IsIn([OrderSide.CASH_IN, OrderSide.CASH_OUT])
  side: OrderSide.CASH_IN | OrderSide.CASH_OUT;

  // Se persiste como `orders.size`, así que hereda su techo.
  @ApiProperty({ example: 50000, description: 'Monto en pesos, entero.' })
  @IsInt()
  @IsPositive()
  @Max(MAX_ORDER_SIZE)
  amount: number;
}
