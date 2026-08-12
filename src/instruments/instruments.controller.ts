import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Instrument } from '../database/entities/instrument.entity';
import { SearchInstrumentsDto } from './dto/search-instruments.dto';
import { InstrumentsService } from './instruments.service';

@ApiTags('instruments')
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Get('search')
  @ApiOperation({ summary: 'Busca instrumentos por ticker y/o nombre' })
  @ApiResponse({
    status: 200,
    description: 'Listado de instrumentos que matchean (excluye MONEDA)',
  })
  @ApiResponse({ status: 400, description: 'Falta el query param "q"' })
  search(@Query() { q }: SearchInstrumentsDto): Promise<Instrument[]> {
    return this.instrumentsService.search(q);
  }
}
