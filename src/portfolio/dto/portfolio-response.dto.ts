import { ApiProperty } from '@nestjs/swagger';

export class PortfolioPositionResponseDto {
  @ApiProperty({ example: 34 })
  instrumentId: number;

  @ApiProperty({ example: 'GGAL' })
  ticker: string;

  @ApiProperty({ example: 'Grupo Financiero Galicia' })
  name: string;

  @ApiProperty({
    example: 10,
    description: 'Cantidad de acciones (Σ BUY − Σ SELL, FILLED)',
  })
  quantity: number;

  @ApiProperty({
    example: 885.8,
    nullable: true,
    type: Number,
    description: 'Último precio conocido del instrumento (marketdata.close)',
  })
  lastPrice: number | null;

  @ApiProperty({
    example: 917.75,
    nullable: true,
    type: Number,
    description: 'Cierre del día anterior (marketdata.previousClose)',
  })
  previousClose: number | null;

  @ApiProperty({ example: 9000, description: 'quantity × lastPrice' })
  marketValue: number;

  @ApiProperty({
    example: 8800,
    description: 'Costo neto invertido (Σ BUY − Σ SELL, en pesos)',
  })
  totalCost: number;

  @ApiProperty({
    example: 2.27,
    description:
      'Rendimiento total contra lo invertido: (marketValue − totalCost) / totalCost × 100',
  })
  performancePct: number;

  @ApiProperty({
    example: 4.65,
    nullable: true,
    type: Number,
    description:
      'Retorno diario: (close − previousClose) / previousClose × 100. ' +
      'null si el instrumento no tiene cierre actual o anterior.',
  })
  dailyReturnPct: number | null;
}

export class PortfolioResponseDto {
  @ApiProperty({ example: 1 })
  userId: number;

  @ApiProperty({ example: 90000 })
  availableCash: number;

  @ApiProperty({ type: [PortfolioPositionResponseDto] })
  positions: PortfolioPositionResponseDto[];

  @ApiProperty({ example: 99000, description: 'availableCash + Σ marketValue' })
  totalAccountValue: number;
}
