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

  @ApiProperty({ example: 9000, description: 'quantity × último close' })
  marketValue: number;

  @ApiProperty({
    example: 8800,
    description: 'Costo neto invertido (Σ BUY − Σ SELL, en pesos)',
  })
  totalCost: number;

  @ApiProperty({
    example: 2.27,
    description: '(marketValue − totalCost) / totalCost × 100',
  })
  performancePct: number;
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
