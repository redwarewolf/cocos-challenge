import { Controller, Get, Query } from '@nestjs/common';
import { Instrument } from '../database/entities/instrument.entity';
import { SearchInstrumentsDto } from './dto/search-instruments.dto';
import { InstrumentsService } from './instruments.service';

@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Get('search')
  search(@Query() { q }: SearchInstrumentsDto): Promise<Instrument[]> {
    return this.instrumentsService.search(q);
  }
}
