import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Instrument,
  InstrumentType,
} from '../database/entities/instrument.entity';

const MAX_RESULTS = 20;

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
   */
  async search(query: string): Promise<Instrument[]> {
    const term = query.trim();
    if (!term) {
      return [];
    }

    return this.instrumentRepository
      .createQueryBuilder('instrument')
      .where('instrument.type != :moneda', { moneda: InstrumentType.MONEDA })
      .andWhere(
        '(instrument.ticker ILIKE :like OR instrument.name ILIKE :like)',
        {
          like: `%${term}%`,
        },
      )
      .setParameter('exact', term)
      .setParameter('prefix', `${term}%`)
      .orderBy(
        `CASE
          WHEN instrument.ticker ILIKE :exact THEN 0
          WHEN instrument.ticker ILIKE :prefix THEN 1
          ELSE 2
        END`,
      )
      .addOrderBy('instrument.ticker', 'ASC')
      .take(MAX_RESULTS)
      .getMany();
  }
}
