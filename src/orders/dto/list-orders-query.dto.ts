import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsPositive } from 'class-validator';
import { OrderStatus } from '../../database/entities/order.entity';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class ListOrdersQueryDto extends PaginationQueryDto {
  @ApiProperty({ example: 1 })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId: number;

  @ApiPropertyOptional({
    enum: OrderStatus,
    description: 'Si no se manda, devuelve órdenes de cualquier estado.',
  })
  @IsOptional()
  @IsEnum(OrderStatus)
  status?: OrderStatus;
}
