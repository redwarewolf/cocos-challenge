import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class SearchInstrumentsDto {
  @ApiProperty({
    example: 'ggal',
    description: 'Ticker o nombre (case-insensitive, substring).',
  })
  @IsString()
  @IsNotEmpty()
  q: string;
}
