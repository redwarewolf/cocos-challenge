import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Instrument,
  InstrumentType,
} from '../database/entities/instrument.entity';
import { Order } from '../database/entities/order.entity';
import { Portfolio, PortfolioPosition } from './valuation.types';

const CASH_TICKER = 'ARS';

@Injectable()
export class ValuationService {
  constructor(
    @InjectRepository(Order)
    private readonly orderRepository: Repository<Order>,
    @InjectRepository(Instrument)
    private readonly instrumentRepository: Repository<Instrument>,
  ) {}

  /** Resolves the id of the instrument that represents cash (ARS), instead of hardcoding it. */
  async getCashInstrument(): Promise<Instrument> {
    const cash = await this.instrumentRepository.findOne({
      where: { ticker: CASH_TICKER, type: InstrumentType.MONEDA },
    });
    if (!cash) {
      throw new NotFoundException(`Cash instrument (${CASH_TICKER}) not found`);
    }
    return cash;
  }

  /** Pesos disponibles para operar: todos los movimientos FILLED (CASH_IN/OUT + BUY/SELL). */
  async getAvailableCash(userId: number): Promise<number> {
    const rows: { available: string | null }[] =
      await this.orderRepository.manager.query(
        `
      SELECT COALESCE(SUM(
        CASE side
          WHEN 'CASH_IN' THEN size * price
          WHEN 'SELL'    THEN size * price
          WHEN 'CASH_OUT' THEN -(size * price)
          WHEN 'BUY'      THEN -(size * price)
          ELSE 0
        END
      ), 0) AS available
      FROM orders
      WHERE userid = $1 AND status = 'FILLED'
      `,
        [userId],
      );
    return Number(rows[0]?.available ?? 0);
  }

  /**
   * Tenencia neta (FILLED BUY - FILLED SELL) de un instrumento para un usuario.
   * Usada tanto para armar el listado de posiciones como para validar ventas.
   */
  async getAvailableQuantity(
    userId: number,
    instrumentId: number,
  ): Promise<number> {
    const rows: { quantity: string | null }[] =
      await this.orderRepository.manager.query(
        `
      SELECT COALESCE(SUM(
        CASE side WHEN 'BUY' THEN size WHEN 'SELL' THEN -size ELSE 0 END
      ), 0) AS quantity
      FROM orders
      WHERE userid = $1 AND instrumentid = $2 AND status = 'FILLED' AND side IN ('BUY', 'SELL')
      `,
        [userId, instrumentId],
      );
    return Number(rows[0]?.quantity ?? 0);
  }

  /** Último precio de cierre conocido (marketdata.close más reciente) para un instrumento. */
  async getLastClose(instrumentId: number): Promise<number | null> {
    const rows: { close: string | null }[] =
      await this.orderRepository.manager.query(
        `SELECT close FROM marketdata WHERE instrumentid = $1 ORDER BY date DESC LIMIT 1`,
        [instrumentId],
      );
    const close = rows[0]?.close;
    return close === undefined || close === null ? null : Number(close);
  }

  /** Listado de posiciones (activos con tenencia positiva), valuadas al último cierre. */
  async getPositions(userId: number): Promise<PortfolioPosition[]> {
    const rows: {
      instrumentId: number;
      ticker: string;
      name: string;
      quantity: string;
      netCost: string;
      lastClose: string | null;
    }[] = await this.orderRepository.manager.query(
      `
      WITH position_orders AS (
        SELECT
          o.instrumentid,
          SUM(CASE WHEN o.side = 'BUY' THEN o.size ELSE -o.size END) AS quantity,
          SUM(CASE WHEN o.side = 'BUY' THEN o.size * o.price ELSE -(o.size * o.price) END) AS net_cost
        FROM orders o
        INNER JOIN instruments i ON i.id = o.instrumentid
        WHERE o.userid = $1 AND o.status = 'FILLED' AND o.side IN ('BUY', 'SELL') AND i.type <> 'MONEDA'
        GROUP BY o.instrumentid
      ),
      latest_price AS (
        SELECT DISTINCT ON (instrumentid) instrumentid, close
        FROM marketdata
        ORDER BY instrumentid, date DESC
      )
      SELECT
        po.instrumentid AS "instrumentId",
        i.ticker,
        i.name,
        po.quantity,
        po.net_cost AS "netCost",
        lp.close AS "lastClose"
      FROM position_orders po
      INNER JOIN instruments i ON i.id = po.instrumentid
      LEFT JOIN latest_price lp ON lp.instrumentid = po.instrumentid
      WHERE po.quantity > 0
      ORDER BY i.ticker
      `,
      [userId],
    );

    return rows.map((row) => {
      const quantity = Number(row.quantity);
      const totalCost = Number(row.netCost);
      const lastClose = row.lastClose === null ? 0 : Number(row.lastClose);
      const marketValue = quantity * lastClose;
      const performancePct =
        totalCost > 0 ? ((marketValue - totalCost) / totalCost) * 100 : 0;

      return {
        instrumentId: row.instrumentId,
        ticker: row.ticker,
        name: row.name,
        quantity,
        marketValue,
        totalCost,
        performancePct,
      };
    });
  }

  async getPortfolio(userId: number): Promise<Portfolio> {
    const [availableCash, positions] = await Promise.all([
      this.getAvailableCash(userId),
      this.getPositions(userId),
    ]);

    const positionsValue = positions.reduce((sum, p) => sum + p.marketValue, 0);

    return {
      userId,
      availableCash,
      positions,
      totalAccountValue: availableCash + positionsValue,
    };
  }
}
