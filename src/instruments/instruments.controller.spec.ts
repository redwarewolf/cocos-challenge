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

  it('search() delega en InstrumentsService.search() con el término "q"', async () => {
    const instruments: Instrument[] = [
      {
        id: 34,
        ticker: 'GGAL',
        name: 'Grupo Financiero Galicia',
        type: InstrumentType.ACCIONES,
      },
    ];
    instrumentsService.search.mockResolvedValue(instruments);

    const result = await controller.search({ q: 'ggal' });

    expect(instrumentsService.search).toHaveBeenCalledWith('ggal');
    expect(result).toBe(instruments);
  });
});
