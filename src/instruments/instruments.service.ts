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
   * Busca instrumentos por ticker o nombre, excluyendo la MONEDA. Ordena por ticker exacto,
   * después por prefijo y después el resto, para que "ggal" devuelva GGAL primero.
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

    // `%` y `_` son wildcards de LIKE: sin escapar, buscar `GG_L` devolvería `GGAL` y `%`
    // el listado entero. La barra va primero en la clase para escaparse a sí misma.
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
