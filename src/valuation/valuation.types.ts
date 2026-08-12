export interface PortfolioPosition {
  instrumentId: number;
  ticker: string;
  name: string;
  quantity: number;
  marketValue: number;
  totalCost: number;
  performancePct: number;
}

export interface Portfolio {
  userId: number;
  availableCash: number;
  positions: PortfolioPosition[];
  totalAccountValue: number;
}
