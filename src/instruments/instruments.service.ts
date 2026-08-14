import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Paginated } from '../common/dto/paginated-response.dto';
import {
  Instrument,
  InstrumentType,
} from '../database/entities/instrument.entity';

@Injectable()
export class InstrumentsService {
  constructor(
    @InjectRepository(Instrument)
    private readonly instrumentRepository: Repository<Instrument>,
  ) {}

  /**
   * Busca por ticker y/o nombre (case-insensitive, substring). Se excluye el instrumento
   * de tipo MONEDA (ARS) porque no es un "activo" que un usuario busque para operar.
   * Los resultados se ordenan priorizando match exacto de ticker, luego prefijo, luego el resto.
   * Paginado con page/limit (offset-based): alcanza para el volumen de un mercado real
   * (miles de instrumentos, no millones), no se justifica paginado por cursor acá.
   */
  async search(
    query: string,
    page: number,
    limit: number,
  ): Promise<Paginated<Instrument>> {
    const term = query.trim();
    if (!term) {
      return { data: [], total: 0, page, limit };
    }

    // `%` y `_` son wildcards de LIKE, así que hay que escaparlos antes de interpolarlos
    // en el patrón. No es un tema de inyección (la query va parametrizada), es de
    // resultados: sin esto, buscar `GG_L` matchea `GGAL` y buscar `%` devuelve el listado
    // entero. El `\` va primero en la clase de caracteres para que se escape a sí mismo.
    const escaped = term.replace(/[\\%_]/g, '\\$&');

    const [data, total] = await this.instrumentRepository
      .createQueryBuilder('instrument')
      .where('instrument.type != :moneda', { moneda: InstrumentType.MONEDA })
      .andWhere(
        '(instrument.ticker ILIKE :like OR instrument.name ILIKE :like)',
        {
          like: `%${escaped}%`,
        },
      )
      // Los patrones del ranking también son ILIKE: sin escapar, un `GG_L` se ordenaría
      // como si fuera match exacto de `GGAL`.
      .setParameter('exact', escaped)
      .setParameter('prefix', `${escaped}%`)
      .orderBy(
        `CASE
          WHEN instrument.ticker ILIKE :exact THEN 0
          WHEN instrument.ticker ILIKE :prefix THEN 1
          ELSE 2
        END`,
      )
      .addOrderBy('instrument.ticker', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    return { data, total, page, limit };
  }
}
