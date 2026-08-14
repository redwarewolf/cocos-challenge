export interface PortfolioPosition {
  instrumentId: number;
  ticker: string;
  name: string;
  quantity: number;
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
