import { Test, TestingModule } from '@nestjs/testing';
import {
  Instrument,
  InstrumentType,
} from '../database/entities/instrument.entity';
import { InstrumentsController } from './instruments.controller';
import { InstrumentsService } from './instruments.service';

describe('InstrumentsController', () => {
  let controller: InstrumentsController;

  const instrumentsService = { search: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InstrumentsController],
      providers: [
        { provide: InstrumentsService, useValue: instrumentsService },
      ],
    }).compile();

    controller = module.get(InstrumentsController);
  });

  it('search() delega en InstrumentsService.search() con el término "q" y page/limit', async () => {
    const instruments: Instrument[] = [
      {
        id: 34,
        ticker: 'GGAL',
        name: 'Grupo Financiero Galicia',
        type: InstrumentType.ACCIONES,
      },
    ];
    const page = { data: instruments, total: 1, page: 1, limit: 20 };
    instrumentsService.search.mockResolvedValue(page);

    const result = await controller.search({ q: 'ggal', page: 1, limit: 20 });

    expect(instrumentsService.search).toHaveBeenCalledWith('ggal', 1, 20);
    expect(result).toBe(page);
  });

  it('usa page=1 y limit=20 por default si no vienen en el query', async () => {
    instrumentsService.search.mockResolvedValue({
      data: [],
      total: 0,
      page: 1,
      limit: 20,
    });

    await controller.search({ q: 'ggal' });

    expect(instrumentsService.search).toHaveBeenCalledWith('ggal', 1, 20);
  });
});
