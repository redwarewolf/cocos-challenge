import { Type } from '@nestjs/common';
import { ApiProperty } from '@nestjs/swagger';

export interface Paginated<T> {
  data: T[];
  total: number;
  page: number;
  limit: number;
}

/**
 * Factory de clase (no una clase genérica real: los decorators de Swagger no
 * soportan tipos genéricos) para documentar respuestas paginadas reutilizando el
 * mismo envelope `{ data, total, page, limit }` en distintos endpoints — patrón
 * recomendado por la propia doc de @nestjs/swagger para "Generics and Interfaces".
 */
export function PaginatedResponseDto<TModel extends object>(
  model: Type<TModel>,
): Type<Paginated<TModel>> {
  class PaginatedResponseClass implements Paginated<TModel> {
    @ApiProperty({ type: [model] })
    data: TModel[];

    @ApiProperty({
      example: 42,
      description: 'Cantidad total de resultados (todas las páginas)',
    })
    total: number;

    @ApiProperty({ example: 1 })
    page: number;

    @ApiProperty({ example: 20 })
    limit: number;
  }
  Object.defineProperty(PaginatedResponseClass, 'name', {
    value: `Paginated${model.name}`,
  });
  return PaginatedResponseClass;
}
