import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import {
  Instrument,
  InstrumentType,
} from '../database/entities/instrument.entity';
import { InstrumentsService } from './instruments.service';

describe('InstrumentsService', () => {
  let service: InstrumentsService;

  // createQueryBuilder() de TypeORM devuelve un objeto encadenable (fluent API);
  // lo simulamos con un mock donde cada método intermedio se devuelve a sí mismo.
  const queryBuilder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    setParameter: jest.fn(),
    orderBy: jest.fn(),
    addOrderBy: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn(),
  };
  const instrumentRepository = {
    createQueryBuilder: jest.fn(() => queryBuilder),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.setParameter.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.addOrderBy.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    queryBuilder.getMany.mockResolvedValue([]);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InstrumentsService,
        {
          provide: getRepositoryToken(Instrument),
          useValue: instrumentRepository,
        },
      ],
    }).compile();

    service = module.get(InstrumentsService);
  });

  it('devuelve [] sin pegarle a la DB si el término está vacío o son solo espacios', async () => {
    const result = await service.search('   ');

    expect(result).toEqual([]);
    expect(instrumentRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('excluye el instrumento de tipo MONEDA de los resultados', async () => {
    await service.search('gal');

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'instrument.type != :moneda',
      {
        moneda: InstrumentType.MONEDA,
      },
    );
  });

  it('busca por ticker y/o nombre con ILIKE (case-insensitive, substring)', async () => {
    await service.search('gal');

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(instrument.ticker ILIKE :like OR instrument.name ILIKE :like)',
      { like: '%gal%' },
    );
  });

  it('recorta espacios del término de búsqueda antes de armar el patrón ILIKE', async () => {
    await service.search('  gal  ');

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.any(String), {
      like: '%gal%',
    });
  });

  it('prioriza match exacto de ticker y luego prefijo de ticker en el orderBy', async () => {
    await service.search('ggal');

    expect(queryBuilder.setParameter).toHaveBeenCalledWith('exact', 'ggal');
    expect(queryBuilder.setParameter).toHaveBeenCalledWith('prefix', 'ggal%');
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining('ticker ILIKE :exact'),
    );
  });

  it('limita los resultados a 20', async () => {
    await service.search('a');

    expect(queryBuilder.take).toHaveBeenCalledWith(20);
  });

  it('devuelve lo que resuelve getMany()', async () => {
    const instruments = [
      {
        id: 34,
        ticker: 'GGAL',
        name: 'Grupo Financiero Galicia',
        type: InstrumentType.ACCIONES,
      },
    ];
    queryBuilder.getMany.mockResolvedValue(instruments);

    const result = await service.search('ggal');

    expect(result).toBe(instruments);
  });
});
