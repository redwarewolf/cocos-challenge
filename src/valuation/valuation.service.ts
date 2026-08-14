import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
import { PinoLogger } from 'nestjs-pino';
import { EntityManager, Repository } from 'typeorm';
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
    private readonly logger: PinoLogger,
  ) {
    this.logger.setContext(ValuationService.name);
  }

  /** Instrumento que representa el cash (ARS), resuelto por ticker en runtime. */
  async getCashInstrument(): Promise<Instrument> {
    const cash = await this.instrumentRepository.findOne({
      where: { ticker: CASH_TICKER, type: InstrumentType.MONEDA },
    });
    if (!cash) {
      throw new NotFoundException(`Cash instrument (${CASH_TICKER}) not found`);
    }
    return cash;
  }

  /**
   * Pesos liquidados: saldo de los movimientos FILLED, sumando CASH_IN y SELL y restando
   * CASH_OUT y BUY.
   *
   * El `manager` opcional permite leer dentro de la transacción que toma el advisory lock,
   * para que la lectura y el insert de la orden sean atómicos.
   */
  async getAvailableCash(
    userId: number,
    manager: EntityManager = this.orderRepository.manager,
  ): Promise<number> {
    const rows: { available: string | null }[] = await manager.query(
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
   * Pesos comprometidos en órdenes de compra que todavía no se ejecutaron: notional de las
   * BUY en estado NEW.
   */
  async getReservedCash(
    userId: number,
    manager: EntityManager = this.orderRepository.manager,
  ): Promise<number> {
    const rows: { reserved: string | null }[] = await manager.query(
      `
      SELECT COALESCE(SUM(size * price), 0) AS reserved
      FROM orders
      WHERE userid = $1 AND status = 'NEW' AND side = 'BUY'
      `,
      [userId],
    );
    return Number(rows[0]?.reserved ?? 0);
  }

  /** Pesos que se pueden comprometer en una orden nueva: liquidado menos reservado. */
  async getBuyingPower(
    userId: number,
    manager: EntityManager = this.orderRepository.manager,
  ): Promise<number> {
    const available = await this.getAvailableCash(userId, manager);
    const reserved = await this.getReservedCash(userId, manager);
    return new Decimal(available).minus(reserved).toNumber();
  }

  /** Tenencia de un instrumento: compras menos ventas, sobre órdenes FILLED. */
  async getAvailableQuantity(
    userId: number,
    instrumentId: number,
    manager: EntityManager = this.orderRepository.manager,
  ): Promise<number> {
    const rows: { quantity: string | null }[] = await manager.query(
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

  /** Acciones comprometidas en ventas que todavía no se ejecutaron: size de las SELL en NEW. */
  async getReservedQuantity(
    userId: number,
    instrumentId: number,
    manager: EntityManager = this.orderRepository.manager,
  ): Promise<number> {
    const rows: { reserved: string | null }[] = await manager.query(
      `
      SELECT COALESCE(SUM(size), 0) AS reserved
      FROM orders
      WHERE userid = $1 AND instrumentid = $2 AND status = 'NEW' AND side = 'SELL'
      `,
      [userId, instrumentId],
    );
    return Number(rows[0]?.reserved ?? 0);
  }

  /** Acciones que el usuario puede vender ahora: la tenencia menos lo ya comprometido. */
  async getSellableQuantity(
    userId: number,
    instrumentId: number,
    manager: EntityManager = this.orderRepository.manager,
  ): Promise<number> {
    const available = await this.getAvailableQuantity(
      userId,
      instrumentId,
      manager,
    );
    const reserved = await this.getReservedQuantity(
      userId,
      instrumentId,
      manager,
    );
    return available - reserved;
  }

  async getLastClose(
    instrumentId: number,
    manager: EntityManager = this.orderRepository.manager,
  ): Promise<number | null> {
    const rows: { close: string | null }[] = await manager.query(
      `SELECT close FROM marketdata WHERE instrumentid = $1 ORDER BY date DESC LIMIT 1`,
      [instrumentId],
    );
    const close = rows[0]?.close;
    return close === undefined || close === null ? null : Number(close);
  }

  /**
   * Instrumentos con tenencia positiva, valuados al último cierre. Cada posición trae dos
   * rendimientos: `performancePct` contra lo invertido y `dailyReturnPct` contra el cierre
   * anterior.
   */
  async getPositions(userId: number): Promise<PortfolioPosition[]> {
    const rows: {
      instrumentId: number;
      ticker: string;
      name: string;
      quantity: string;
      buyAmount: string;
      buySize: string;
      lastClose: string | null;
      previousClose: string | null;
      reservedQuantity: string;
    }[] = await this.orderRepository.manager.query(
      `
      WITH position_orders AS (
        SELECT
          o.instrumentid,
          SUM(CASE WHEN o.side = 'BUY' THEN o.size ELSE -o.size END) AS quantity,
          -- Solo compras: alimentan el precio promedio con el que se valúa el costo.
          SUM(CASE WHEN o.side = 'BUY' THEN o.size * o.price ELSE 0 END) AS buy_amount,
          SUM(CASE WHEN o.side = 'BUY' THEN o.size ELSE 0 END) AS buy_size
        FROM orders o
        INNER JOIN instruments i ON i.id = o.instrumentid
        WHERE o.userid = $1 AND o.status = 'FILLED' AND o.side IN ('BUY', 'SELL') AND i.type <> 'MONEDA'
        GROUP BY o.instrumentid
      )
      SELECT
        po.instrumentid AS "instrumentId",
        i.ticker,
        i.name,
        po.quantity,
        po.buy_amount AS "buyAmount",
        po.buy_size AS "buySize",
        lp.close AS "lastClose",
        lp.previousclose AS "previousClose",
        r.reserved AS "reservedQuantity"
      FROM position_orders po
      INNER JOIN instruments i ON i.id = po.instrumentid
      -- Correlacionado por instrumento: un seek por posición contra
      -- uq_marketdata_instrumentid_date, en vez de ordenar marketdata entera para quedarse
      -- con una fila por instrumento.
      LEFT JOIN LATERAL (
        SELECT close, previousclose
        FROM marketdata
        WHERE instrumentid = po.instrumentid
        ORDER BY date DESC
        LIMIT 1
      ) lp ON true
      LEFT JOIN LATERAL (
        SELECT COALESCE(SUM(size), 0) AS reserved
        FROM orders
        WHERE userid = $1 AND instrumentid = po.instrumentid
          AND status = 'NEW' AND side = 'SELL'
      ) r ON true
      WHERE po.quantity <> 0
      ORDER BY i.ticker
      `,
      [userId],
    );

    // Un neto negativo son más ventas FILLED que compras: datos inconsistentes, porque la API
    // impide vender de más. El neto en cero, en cambio, es una posición cerrada normal.
    const enDescubierto = rows.filter((row) => Number(row.quantity) < 0);
    if (enDescubierto.length > 0) {
      this.logger.warn(
        {
          userId,
          instrumentIds: enDescubierto.map((row) => row.instrumentId),
        },
        'Tenencia neta negativa: hay más ventas FILLED que compras',
      );
    }

    return rows
      .filter((row) => Number(row.quantity) > 0)
      .map((row) => {
        const quantity = new Decimal(row.quantity);

        // Costo promedio ponderado: precio promedio de compra × lo que queda en cartera.
        // Cada venta se considera consumida a ese promedio (ver DECISIONS.md §4).
        const buySize = new Decimal(row.buySize);
        const totalCost = buySize.greaterThan(0)
          ? new Decimal(row.buyAmount).dividedBy(buySize).times(quantity)
          : new Decimal(0);

        // Sin cotización el valor de la posición es desconocido, no cero.
        const lastClose =
          row.lastClose === null ? null : new Decimal(row.lastClose);
        const marketValue =
          lastClose === null ? null : quantity.times(lastClose);

        let performancePct: number | null = null;
        if (marketValue !== null) {
          performancePct = totalCost.greaterThan(0)
            ? marketValue
                .minus(totalCost)
                .dividedBy(totalCost)
                .times(100)
                .toDecimalPlaces(2)
                .toNumber()
            : 0;
        }

        // Retorno del día contra el cierre anterior, que `marketdata` trae en la misma fila.
        const previousClose =
          row.previousClose === null ? null : new Decimal(row.previousClose);
        const dailyReturnPct =
          lastClose !== null &&
          previousClose !== null &&
          previousClose.greaterThan(0)
            ? lastClose
                .minus(previousClose)
                .dividedBy(previousClose)
                .times(100)
                .toDecimalPlaces(2)
                .toNumber()
            : // Sin alguno de los dos precios el retorno es desconocido, no cero.
              null;

        return {
          instrumentId: row.instrumentId,
          ticker: row.ticker,
          name: row.name,
          quantity: quantity.toNumber(),
          reservedQuantity: Number(row.reservedQuantity),
          lastPrice: lastClose === null ? null : lastClose.toNumber(),
          previousClose:
            previousClose === null ? null : previousClose.toNumber(),
          marketValue:
            marketValue === null
              ? null
              : marketValue.toDecimalPlaces(2).toNumber(),
          totalCost: totalCost.toDecimalPlaces(2).toNumber(),
          performancePct,
          dailyReturnPct,
        };
      });
  }

  async getPortfolio(userId: number): Promise<Portfolio> {
    const [availableCash, reservedCash, positions] = await Promise.all([
      this.getAvailableCash(userId),
      this.getReservedCash(userId),
      this.getPositions(userId),
    ]);

    // Las posiciones sin cotización no se pueden valuar, así que no suman al total.
    const positionsValue = positions.reduce(
      (sum, p) => (p.marketValue === null ? sum : sum.plus(p.marketValue)),
      new Decimal(0),
    );

    return {
      userId,
      availableCash,
      reservedCash,
      buyingPower: new Decimal(availableCash).minus(reservedCash).toNumber(),
      positions,
      totalAccountValue: new Decimal(availableCash)
        .plus(positionsValue)
        .toDecimalPlaces(2)
        .toNumber(),
      hasUnvaluedPositions: positions.some((p) => p.marketValue === null),
    };
  }
}
