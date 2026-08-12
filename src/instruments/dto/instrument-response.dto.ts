import { ApiProperty } from '@nestjs/swagger';
import { InstrumentType } from '../../database/entities/instrument.entity';

export class InstrumentResponseDto {
  @ApiProperty({ example: 34 })
  id: number;

  @ApiProperty({ example: 'GGAL' })
  ticker: string;

  @ApiProperty({ example: 'Grupo Financiero Galicia' })
  name: string;

  @ApiProperty({
    enum: InstrumentType,
    description: 'GET /instruments/search nunca devuelve MONEDA',
  })
  type: InstrumentType;
}
