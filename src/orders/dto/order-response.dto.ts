import { ApiProperty } from '@nestjs/swagger';
import {
  OrderSide,
  OrderStatus,
  OrderType,
} from '../../database/entities/order.entity';

/**
 * Documenta la forma real de lo que devuelven POST /orders, POST /orders/cash y
 * PATCH /orders/:id/cancel (la entidad `Order`, sin las relaciones `instrument`/`user`
 * que nunca se cargan y por lo tanto nunca viajan en la respuesta real).
 */
export class OrderResponseDto {
  @ApiProperty({ example: 1 })
  id: number;

  @ApiProperty({ example: 34 })
  instrumentId: number;

  @ApiProperty({ example: 1 })
  userId: number;

  @ApiProperty({ example: 10 })
  size: number;

  @ApiProperty({ example: '900.00', description: 'NUMERIC(10,2) como string' })
  price: string;

  @ApiProperty({ enum: OrderType })
  type: OrderType;

  @ApiProperty({ enum: OrderSide })
  side: OrderSide;

  @ApiProperty({ enum: OrderStatus })
  status: OrderStatus;

  @ApiProperty({ example: '2024-01-01T10:00:00.000Z' })
  datetime: Date;

  @ApiProperty({
    example: null,
    nullable: true,
    description: 'Header Idempotency-Key con el que se creó, si se mandó uno',
  })
  idempotencyKey: string | null;
}
