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
    example: 0,
    description:
      'Acciones comprometidas en órdenes SELL en estado NEW. No se pueden volver a vender ' +
      'hasta que esas órdenes se ejecuten o se cancelen.',
  })
  reservedQuantity: number;

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

  @ApiProperty({
    example: 9000,
    nullable: true,
    type: Number,
    description:
      'quantity × lastPrice. null si el instrumento no tiene cotización: el valor es ' +
      'desconocido, no cero, y la posición no suma a totalAccountValue.',
  })
  marketValue: number | null;

  @ApiProperty({
    example: 8800,
    description:
      'Costo de la tenencia actual, por costo promedio ponderado: ' +
      'Σ(size·price)(BUY) / Σ size(BUY) × quantity',
  })
  totalCost: number;

  @ApiProperty({
    example: 2.27,
    nullable: true,
    type: Number,
    description:
      'Rendimiento total contra lo invertido: (marketValue − totalCost) / totalCost × 100. ' +
      'null si no hay marketValue contra el cual medir el costo.',
  })
  performancePct: number | null;

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

  @ApiProperty({
    example: 90000,
    description: 'Pesos liquidados: solo movimientos FILLED',
  })
  availableCash: number;

  @ApiProperty({
    example: 10000,
    description: 'Pesos comprometidos en órdenes BUY en estado NEW',
  })
  reservedCash: number;

  @ApiProperty({
    example: 80000,
    description:
      'availableCash − reservedCash. Es contra este número que se valida una orden nueva.',
  })
  buyingPower: number;

  @ApiProperty({ type: [PortfolioPositionResponseDto] })
  positions: PortfolioPositionResponseDto[];

  @ApiProperty({
    example: 99000,
    description:
      'availableCash + Σ marketValue, salteando las posiciones sin cotización',
  })
  totalAccountValue: number;

  @ApiProperty({
    example: false,
    description:
      'true si alguna posición quedó sin valuar, así el cliente sabe que ' +
      'totalAccountValue no la incluye',
  })
  hasUnvaluedPositions: boolean;
}
