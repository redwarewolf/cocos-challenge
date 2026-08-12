import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsInt, IsPositive } from 'class-validator';
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

  @ApiProperty({ example: 50000, description: 'Monto en pesos, entero.' })
  @IsInt()
  @IsPositive()
  amount: number;
}
