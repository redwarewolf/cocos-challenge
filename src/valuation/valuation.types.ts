export interface PortfolioPosition {
  instrumentId: number;
  ticker: string;
  name: string;
  quantity: number;
  /** `marketdata.close` más reciente. `null` solo si el instrumento no tiene marketdata. */
  lastPrice: number | null;
  /** Cierre del día anterior, del que sale `dailyReturnPct`. */
  previousClose: number | null;
  marketValue: number;
  totalCost: number;
  performancePct: number;
  /** `null` cuando falta el cierre actual o el anterior para el instrumento. */
  dailyReturnPct: number | null;
}

export interface Portfolio {
  userId: number;
  availableCash: number;
  positions: PortfolioPosition[];
  totalAccountValue: number;
}
