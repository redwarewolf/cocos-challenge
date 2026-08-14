import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import Decimal from 'decimal.js';
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

  /**
   * Pesos disponibles para operar: todos los movimientos FILLED (CASH_IN/OUT + BUY/SELL).
   *
   * Acepta un `manager` transaccional opcional: OrdersService lo usa para leer este valor
   * dentro de la misma transacción en la que toma el advisory lock por usuario, así la
   * lectura y el insert de la orden quedan protegidos contra condiciones de carrera
   * (ver OrdersService.create).
   *
   * Sin `Decimal` a propósito: la suma la hace Postgres en `NUMERIC` (aritmética decimal
   * exacta), así que `rows[0].available` ya llega como un string sin error de floats — acá
   * solo se lo parsea una vez a `number`, no se opera sobre él. `Decimal` hace falta en
   * `getPositions`/`getPortfolio` porque ahí sí se encadenan operaciones en JS.
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
   * Tenencia neta (FILLED BUY - FILLED SELL) de un instrumento para un usuario.
   * Usada tanto para armar el listado de posiciones como para validar ventas
   * (mismo motivo del parámetro `manager` que en getAvailableCash).
   */
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

  /** Último precio de cierre conocido (marketdata.close más reciente) para un instrumento. */
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
   * Listado de posiciones (activos con tenencia positiva), valuadas al último cierre.
   *
   * Cada posición trae dos rendimientos, que responden preguntas distintas:
   * `performancePct` es el rendimiento total contra lo invertido (sale de las órdenes
   * FILLED) y `dailyReturnPct` es el retorno del día contra el cierre anterior (sale de
   * marketdata). Ninguno de los dos reemplaza al otro.
   */
  async getPositions(userId: number): Promise<PortfolioPosition[]> {
    const rows: {
      instrumentId: number;
      ticker: string;
      name: string;
      quantity: string;
      netCost: string;
      lastClose: string | null;
      previousClose: string | null;
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
        SELECT DISTINCT ON (instrumentid) instrumentid, close, previousclose
        FROM marketdata
        ORDER BY instrumentid, date DESC
      )
      SELECT
        po.instrumentid AS "instrumentId",
        i.ticker,
        i.name,
        po.quantity,
        po.net_cost AS "netCost",
        lp.close AS "lastClose",
        lp.previousclose AS "previousClose"
      FROM position_orders po
      INNER JOIN instruments i ON i.id = po.instrumentid
      LEFT JOIN latest_price lp ON lp.instrumentid = po.instrumentid
      WHERE po.quantity > 0
      ORDER BY i.ticker
      `,
      [userId],
    );

    return rows.map((row) => {
      const quantity = new Decimal(row.quantity);
      const totalCost = new Decimal(row.netCost);
      const lastClose =
        row.lastClose === null ? new Decimal(0) : new Decimal(row.lastClose);
      const marketValue = quantity.times(lastClose);
      const performancePct = totalCost.greaterThan(0)
        ? marketValue.minus(totalCost).dividedBy(totalCost).times(100)
        : new Decimal(0);

      // `previousclose` ya trae el cierre del día anterior en la misma fila de marketdata,
      // así que el retorno diario no necesita un self-join contra el día previo: alcanza
      // con la fila que `latest_price` ya seleccionó. Da igual calcularlo por acción o
      // sobre la posición entera (la cantidad se cancela), así que el porcentaje no
      // depende de la tenencia.
      const previousClose =
        row.previousClose === null ? null : new Decimal(row.previousClose);
      const dailyReturnPct =
        row.lastClose !== null &&
        previousClose !== null &&
        previousClose.greaterThan(0)
          ? lastClose
              .minus(previousClose)
              .dividedBy(previousClose)
              .times(100)
              .toDecimalPlaces(2)
              .toNumber()
          : // `null` y no 0: sin alguno de los dos precios el retorno es desconocido, y un
            // 0 sería indistinguible de "el precio no se movió".
            null;

      return {
        instrumentId: row.instrumentId,
        ticker: row.ticker,
        name: row.name,
        quantity: quantity.toNumber(),
        marketValue: marketValue.toDecimalPlaces(2).toNumber(),
        totalCost: totalCost.toDecimalPlaces(2).toNumber(),
        performancePct: performancePct.toDecimalPlaces(2).toNumber(),
        dailyReturnPct,
      };
    });
  }

  async getPortfolio(userId: number): Promise<Portfolio> {
    const [availableCash, positions] = await Promise.all([
      this.getAvailableCash(userId),
      this.getPositions(userId),
    ]);

    const positionsValue = positions.reduce(
      (sum, p) => sum.plus(p.marketValue),
      new Decimal(0),
    );

    return {
      userId,
      availableCash,
      positions,
      totalAccountValue: new Decimal(availableCash)
        .plus(positionsValue)
        .toDecimalPlaces(2)
        .toNumber(),
    };
  }
}
