import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsPositive } from 'class-validator';

/**
 * `userId` es obligatorio, igual que en el resto de los endpoints: sin él, cancelar una
 * orden solo requeriría adivinar un id, y sería el único endpoint de la API que opera
 * sobre datos de un usuario sin saber de qué usuario se trata.
 */
export class CancelOrderQueryDto {
  @ApiProperty({ example: 1, description: 'Dueño de la orden a cancelar' })
  @Type(() => Number)
  @IsInt()
  @IsPositive()
  userId: number;
}
