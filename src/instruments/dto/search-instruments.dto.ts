import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

export class SearchInstrumentsDto extends PaginationQueryDto {
  @ApiProperty({
    example: 'ggal',
    description: 'Ticker o nombre (case-insensitive, substring).',
  })
  @IsString()
  @IsNotEmpty()
  q: string;
}
