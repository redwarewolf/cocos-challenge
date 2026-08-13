import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_PAGE_SIZE, PAGE_SIZE } from '../../config/config';

/**
 * Query params de paginación compartidos entre endpoints (búsqueda de instrumentos,
 * historial de órdenes). `@Type(() => Number)` es necesario para que class-validator
 * valide un número real: los query params llegan como string y el ValidationPipe
 * global no tiene `enableImplicitConversion`.
 */
export class PaginationQueryDto {
  @ApiPropertyOptional({ example: 1, default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number = 1;

  @ApiPropertyOptional({
    example: PAGE_SIZE,
    default: PAGE_SIZE,
    minimum: 1,
    maximum: MAX_PAGE_SIZE,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit?: number = PAGE_SIZE;
}
