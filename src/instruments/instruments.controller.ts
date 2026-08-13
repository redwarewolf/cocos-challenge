import { Controller, Get, Query } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  Paginated,
  PaginatedResponseDto,
} from '../common/dto/paginated-response.dto';
import { PAGE_SIZE } from '../config/config';
import { InstrumentResponseDto } from './dto/instrument-response.dto';
import { SearchInstrumentsDto } from './dto/search-instruments.dto';
import { InstrumentsService } from './instruments.service';

@ApiTags('instruments')
@Controller('instruments')
export class InstrumentsController {
  constructor(private readonly instrumentsService: InstrumentsService) {}

  @Get('search')
  @ApiOperation({
    summary: 'Busca instrumentos por ticker y/o nombre (paginado)',
  })
  @ApiResponse({
    status: 200,
    description: 'Página de instrumentos que matchean (excluye MONEDA)',
    type: PaginatedResponseDto(InstrumentResponseDto),
  })
  @ApiResponse({
    status: 400,
    description: 'Falta el query param "q", o page/limit inválidos',
  })
  search(
    @Query() { q, page, limit }: SearchInstrumentsDto,
  ): Promise<Paginated<InstrumentResponseDto>> {
    return this.instrumentsService.search(q, page ?? 1, limit ?? PAGE_SIZE);
  }
}
