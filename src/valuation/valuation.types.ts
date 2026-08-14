export interface PortfolioPosition {
  instrumentId: number;
  ticker: string;
  name: string;
  quantity: number;
  /** `marketdata.close` más reciente. `null` solo si el instrumento no tiene marketdata. */
  lastPrice: number | null;
  /** Cierre del día anterior, del que sale `dailyReturnPct`. */
  previousClose: number | null;
  /** `null` si el instrumento no tiene cotización: el valor es desconocido, no cero. */
  marketValue: number | null;
  totalCost: number;
  /** `null` cuando no hay `marketValue` contra el cual medir el costo. */
  performancePct: number | null;
  /** `null` cuando falta el cierre actual o el anterior para el instrumento. */
  dailyReturnPct: number | null;
}

export interface Portfolio {
  userId: number;
  availableCash: number;
  positions: PortfolioPosition[];
  totalAccountValue: number;
  /** `true` si alguna posición quedó sin valuar y no está incluida en el total. */
  hasUnvaluedPositions: boolean;
}
