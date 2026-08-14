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
    skip: jest.fn(),
    take: jest.fn(),
    getManyAndCount: jest.fn(),
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
    queryBuilder.skip.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    queryBuilder.getManyAndCount.mockResolvedValue([[], 0]);

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

  it('devuelve una página vacía sin pegarle a la DB si el término está vacío o son solo espacios', async () => {
    const result = await service.search('   ', 1, 20);

    expect(result).toEqual({ data: [], total: 0, page: 1, limit: 20 });
    expect(instrumentRepository.createQueryBuilder).not.toHaveBeenCalled();
  });

  it('excluye el instrumento de tipo MONEDA de los resultados', async () => {
    await service.search('gal', 1, 20);

    expect(queryBuilder.where).toHaveBeenCalledWith(
      'instrument.type != :moneda',
      {
        moneda: InstrumentType.MONEDA,
      },
    );
  });

  it('busca por ticker y/o nombre con ILIKE (case-insensitive, substring)', async () => {
    await service.search('gal', 1, 20);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      '(instrument.ticker ILIKE :like OR instrument.name ILIKE :like)',
      { like: '%gal%' },
    );
  });

  it('recorta espacios del término de búsqueda antes de armar el patrón ILIKE', async () => {
    await service.search('  gal  ', 1, 20);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.any(String), {
      like: '%gal%',
    });
  });

  it('prioriza match exacto de ticker y luego prefijo de ticker en el orderBy', async () => {
    await service.search('ggal', 1, 20);

    expect(queryBuilder.setParameter).toHaveBeenCalledWith('exact', 'ggal');
    expect(queryBuilder.setParameter).toHaveBeenCalledWith('prefix', 'ggal%');
    expect(queryBuilder.orderBy).toHaveBeenCalledWith(
      expect.stringContaining('ticker ILIKE :exact'),
    );
  });

  it('escapa los wildcards de LIKE en el patrón de búsqueda', async () => {
    // Sin escapar, `_` matchea cualquier carácter: buscar GG_L devolvería GGAL.
    await service.search('GG_L', 1, 20);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.any(String), {
      like: '%GG\\_L%',
    });
  });

  it('escapa el % para que no devuelva el listado entero', async () => {
    await service.search('%', 1, 20);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.any(String), {
      like: '%\\%%',
    });
  });

  it('escapa la propia barra invertida', async () => {
    await service.search('a\\b', 1, 20);

    expect(queryBuilder.andWhere).toHaveBeenCalledWith(expect.any(String), {
      like: '%a\\\\b%',
    });
  });

  it('escapa también los patrones del ranking (exact/prefix son ILIKE igual)', async () => {
    await service.search('GG_L', 1, 20);

    expect(queryBuilder.setParameter).toHaveBeenCalledWith('exact', 'GG\\_L');
    expect(queryBuilder.setParameter).toHaveBeenCalledWith('prefix', 'GG\\_L%');
  });

  it('calcula skip/take a partir de page/limit (offset-based)', async () => {
    await service.search('a', 3, 10);

    expect(queryBuilder.skip).toHaveBeenCalledWith(20); // (page 3 - 1) * limit 10
    expect(queryBuilder.take).toHaveBeenCalledWith(10);
  });

  it('usa skip=0 en la primera página', async () => {
    await service.search('a', 1, 20);

    expect(queryBuilder.skip).toHaveBeenCalledWith(0);
    expect(queryBuilder.take).toHaveBeenCalledWith(20);
  });

  it('devuelve data/total desde getManyAndCount(), junto con page y limit', async () => {
    const instruments = [
      {
        id: 34,
        ticker: 'GGAL',
        name: 'Grupo Financiero Galicia',
        type: InstrumentType.ACCIONES,
      },
    ];
    queryBuilder.getManyAndCount.mockResolvedValue([instruments, 37]);

    const result = await service.search('ggal', 2, 20);

    expect(result).toEqual({
      data: instruments,
      total: 37,
      page: 2,
      limit: 20,
    });
  });
});
