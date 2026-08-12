import { IsNotEmpty, IsString } from 'class-validator';

export class SearchInstrumentsDto {
  @IsString()
  @IsNotEmpty()
  q: string;
}
