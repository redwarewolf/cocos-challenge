import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import {
  Instrument,
  InstrumentType,
} from '../database/entities/instrument.entity';
import { Order } from '../database/entities/order.entity';
import { ValuationService } from './valuation.service';

describe('ValuationService', () => {
  let service: ValuationService;

  // se guarda una referencia plana al jest.fn() (en vez de leer `manager.query` cada vez)
  // para no disparar @typescript-eslint/unbound-method al pasarlo "sin bindear" a expect().
  const queryFn = jest.fn();
  const manager = { query: queryFn } as unknown as EntityManager;
  const orderRepository = { manager };
  const instrumentRepository = { findOne: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ValuationService,
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        {
          provide: getRepositoryToken(Instrument),
          useValue: instrumentRepository,
        },
      ],
    }).compile();

    service = module.get(ValuationService);
  });

  describe('getCashInstrument', () => {
    it('resuelve el instrumento ARS por ticker + type, no por id hardcodeado', async () => {
      instrumentRepository.findOne.mockResolvedValue({
        id: 66,
        ticker: 'ARS',
        name: 'PESOS',
        type: InstrumentType.MONEDA,
      });

      const cash = await service.getCashInstrument();

      expect(cash.id).toBe(66);
      expect(instrumentRepository.findOne).toHaveBeenCalledWith({
        where: { ticker: 'ARS', type: InstrumentType.MONEDA },
      });
    });

    it('lanza 404 si no existe el instrumento MONEDA', async () => {
      instrumentRepository.findOne.mockResolvedValue(null);

      await expect(service.getCashInstrument()).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('getAvailableCash', () => {
    it('devuelve 0 cuando el usuario no tiene movimientos FILLED', async () => {
      queryFn.mockResolvedValue([{ available: null }]);

      const result = await service.getAvailableCash(1, manager);

      expect(result).toBe(0);
    });

    it('convierte el numeric (string) de Postgres a number', async () => {
      queryFn.mockResolvedValue([{ available: '748571.00' }]);

      const result = await service.getAvailableCash(1, manager);

      expect(result).toBe(748571);
    });

    it('usa this.orderRepository.manager si no se pasa un manager transaccional', async () => {
      queryFn.mockResolvedValue([{ available: '100' }]);

      const result = await service.getAvailableCash(1);

      expect(result).toBe(100);
      expect(queryFn).toHaveBeenCalledWith(
        expect.stringContaining("status = 'FILLED'"),
        [1],
      );
    });
  });

  describe('getAvailableQuantity', () => {
    it('devuelve la tenencia neta (BUY - SELL) para un instrumento puntual', async () => {
      queryFn.mockResolvedValue([{ quantity: '40' }]);

      const result = await service.getAvailableQuantity(1, 47, manager);

      expect(result).toBe(40);
      expect(queryFn).toHaveBeenCalledWith(expect.any(String), [1, 47]);
    });

    it('devuelve 0 si no hay órdenes FILLED de ese instrumento', async () => {
      queryFn.mockResolvedValue([{ quantity: null }]);

      const result = await service.getAvailableQuantity(1, 999, manager);

      expect(result).toBe(0);
    });
  });

  describe('getLastClose', () => {
    it('devuelve null si el instrumento no tiene marketdata', async () => {
      queryFn.mockResolvedValue([]);

      const result = await service.getLastClose(999, manager);

      expect(result).toBeNull();
    });

    it('devuelve el último close como number', async () => {
      queryFn.mockResolvedValue([{ close: '885.80' }]);

      const result = await service.getLastClose(34, manager);

      expect(result).toBe(885.8);
    });
  });

  describe('getPositions', () => {
    it('calcula marketValue y performancePct a partir de quantity/buyAmount/lastClose', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: 'Pampa Holding S.A.',
          quantity: '40',
          buyAmount: '37100.00',
          buySize: '40',
          lastClose: '925.85',
          previousClose: '900.00',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.instrumentId).toBe(47);
      expect(position.quantity).toBe(40);
      expect(position.totalCost).toBe(37100);
      expect(position.marketValue).toBeCloseTo(37034, 5);
      // -0.177897...% redondeado a 2 decimales: la API no devuelve el valor crudo, para
      // no arrastrar el ruido de punto flotante hasta la respuesta.
      expect(position.performancePct).toBe(-0.18);
    });

    it('calcula dailyReturnPct con close/previousClose, independiente del costo', async () => {
      // El rendimiento total es negativo (se compró más caro que el cierre actual) y el
      // retorno diario es positivo (el papel subió hoy): son métricas distintas y este
      // caso lo deja explícito.
      queryFn.mockResolvedValue([
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: 'Pampa Holding S.A.',
          quantity: '40',
          buyAmount: '37100.00',
          buySize: '40',
          lastClose: '925.85',
          previousClose: '900.00',
        },
      ]);

      const [position] = await service.getPositions(1);

      // (925.85 - 900) / 900 * 100 = 2.8722...
      expect(position.dailyReturnPct).toBe(2.87);
      expect(position.performancePct).toBe(-0.18);
      // Los dos precios viajan en la respuesta para que el retorno sea auditable:
      // previousClose no se puede reconstruir a partir del resto del payload.
      expect(position.lastPrice).toBe(925.85);
      expect(position.previousClose).toBe(900);
    });

    it('dailyReturnPct es negativo cuando el cierre bajó respecto del anterior', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '10',
          buyAmount: '1000.00',
          buySize: '10',
          lastClose: '90',
          previousClose: '100',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.dailyReturnPct).toBe(-10);
    });

    it('dailyReturnPct es null si el instrumento no tiene previousClose', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '10',
          buyAmount: '1000.00',
          buySize: '10',
          lastClose: '100',
          previousClose: null,
        },
      ]);

      const [position] = await service.getPositions(1);

      // null y no 0: sin cierre anterior el retorno es desconocido, y un 0 se leería
      // como "no se movió".
      expect(position.dailyReturnPct).toBeNull();
    });

    it('dailyReturnPct es null si previousClose es 0 (evita división por cero)', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '10',
          buyAmount: '1000.00',
          buySize: '10',
          lastClose: '100',
          previousClose: '0',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.dailyReturnPct).toBeNull();
    });

    it('performancePct es 0 cuando totalCost es <= 0 (evita división por cero)', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '10',
          buyAmount: '0.00',
          buySize: '10',
          lastClose: '100',
          previousClose: '95',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.performancePct).toBe(0);
    });

    it('marketValue y performancePct son null si el instrumento no tiene marketdata', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '10',
          buyAmount: '1000.00',
          buySize: '10',
          lastClose: null,
          previousClose: '100',
        },
      ]);

      const [position] = await service.getPositions(1);

      // 0 daría -100% de rendimiento sobre una posición cuyo valor simplemente no se
      // conoce: es la misma distinción que ya hace dailyReturnPct.
      expect(position.marketValue).toBeNull();
      expect(position.performancePct).toBeNull();
      // Sin cierre actual no hay retorno diario, aunque haya cierre anterior.
      expect(position.dailyReturnPct).toBeNull();
      expect(position.lastPrice).toBeNull();
      // El costo sí se conoce: sale de las órdenes, no del mercado.
      expect(position.totalCost).toBe(1000);
    });

    it('devuelve [] si el usuario no tiene posiciones', async () => {
      queryFn.mockResolvedValue([]);

      const positions = await service.getPositions(1);

      expect(positions).toEqual([]);
    });

    it('marketValue === totalCost da performancePct exactamente 0, sin ruido de floats', async () => {
      // 100 * 19.9 en floats nativos de JS da 1989.9999999999998, no 1990: sin decimal.js
      // el performancePct sale -1.14e-14 en vez de 0.
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '100',
          buyAmount: '1990.00',
          buySize: '100',
          lastClose: '19.90',
          previousClose: '19.90',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.marketValue).toBe(1990);
      expect(position.performancePct).toBe(0);
    });

    it('el costo no depende del precio al que se vendió: vender con ganancia no lo vuelve negativo', async () => {
      // Escenario: BUY 10 @ 800 y SELL 5 @ 2000. Quedan 5 a un costo promedio de 800.
      // Calcular el costo como Σ BUY − Σ SELL daría 8000 − 10000 = -2000: un costo
      // negativo, que además cae en el guard `performancePct > 0` y reporta 0% justo
      // en el caso donde más se ganó.
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '5',
          buyAmount: '8000.00',
          buySize: '10',
          lastClose: '900',
          previousClose: '900',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.totalCost).toBe(4000);
      expect(position.marketValue).toBe(4500);
      expect(position.performancePct).toBe(12.5);
    });

    it('distorsiona el rendimiento aunque el costo no llegue a ser negativo', async () => {
      // Escenario: BUY 10 @ 100 y SELL 5 @ 150, cotización actual 160.
      // Σ BUY − Σ SELL daría un costo de 1000 − 750 = 250 y un performancePct de
      // (800 − 250) / 250 = 220%: positivo, plausible y sin disparar ningún guard,
      // cuando el rendimiento real de la posición es 60% (de 100 a 160).
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '5',
          buyAmount: '1000.00',
          buySize: '10',
          lastClose: '160',
          previousClose: '160',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.totalCost).toBe(500);
      expect(position.marketValue).toBe(800);
      expect(position.performancePct).toBe(60);
    });

    it('pondera el costo cuando se compró a precios distintos', async () => {
      // BUY 10 @ 100 + BUY 10 @ 200 = 3000 por 20 unidades ⇒ promedio 150.
      // Quedan 15 en cartera ⇒ costo 2250, contra un valor de mercado de 3000.
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '15',
          buyAmount: '3000.00',
          buySize: '20',
          lastClose: '200',
          previousClose: '200',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.totalCost).toBe(2250);
      expect(position.marketValue).toBe(3000);
      expect(position.performancePct).toBe(33.33);
    });

    it('totalCost es 0 si no hay compras (guard de división por cero)', async () => {
      // No es alcanzable con datos consistentes —no se puede tener tenencia sin haber
      // comprado— pero el promedio divide por buySize, así que el guard va igual.
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '5',
          buyAmount: '0.00',
          buySize: '0',
          lastClose: '100',
          previousClose: '100',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.totalCost).toBe(0);
      expect(position.performancePct).toBe(0);
    });
  });

  describe('getPortfolio', () => {
    it('combina cash disponible + valor de las posiciones en totalAccountValue', async () => {
      queryFn
        .mockResolvedValueOnce([{ available: '748571.00' }]) // getAvailableCash
        .mockResolvedValueOnce([
          {
            instrumentId: 47,
            ticker: 'PAMP',
            name: 'Pampa Holding S.A.',
            quantity: '40',
            buyAmount: '37100.00',
            buySize: '40',
            lastClose: '925.85',
            previousClose: '900.00',
          },
        ]); // getPositions

      const portfolio = await service.getPortfolio(1);

      expect(portfolio.userId).toBe(1);
      expect(portfolio.availableCash).toBe(748571);
      expect(portfolio.positions).toHaveLength(1);
      expect(portfolio.totalAccountValue).toBeCloseTo(748571 + 37034, 5);
      expect(portfolio.hasUnvaluedPositions).toBe(false);
    });

    it('excluye del total las posiciones sin cotización y lo señala', async () => {
      queryFn
        .mockResolvedValueOnce([{ available: '100000.00' }])
        .mockResolvedValueOnce([
          {
            instrumentId: 47,
            ticker: 'PAMP',
            name: 'Pampa Holding S.A.',
            quantity: '40',
            buyAmount: '37100.00',
            buySize: '40',
            lastClose: '925.85',
            previousClose: '900.00',
          },
          {
            instrumentId: 10,
            ticker: 'IRCP',
            name: 'IRSA Propiedades',
            quantity: '5',
            buyAmount: '5000.00',
            buySize: '5',
            lastClose: null,
            previousClose: null,
          },
        ]);

      const portfolio = await service.getPortfolio(1);

      // Solo suma PAMP: valuar IRCP en 0 hundiría el total por una posición que
      // probablemente valga algo, y el cliente no tendría cómo notarlo.
      expect(portfolio.totalAccountValue).toBeCloseTo(100000 + 37034, 5);
      expect(portfolio.hasUnvaluedPositions).toBe(true);
      expect(portfolio.positions).toHaveLength(2);
    });

    it('totalAccountValue = availableCash cuando no hay posiciones', async () => {
      queryFn
        .mockResolvedValueOnce([{ available: '0' }])
        .mockResolvedValueOnce([]);

      const portfolio = await service.getPortfolio(2);

      expect(portfolio.availableCash).toBe(0);
      expect(portfolio.positions).toEqual([]);
      expect(portfolio.totalAccountValue).toBe(0);
      expect(portfolio.hasUnvaluedPositions).toBe(false);
    });
  });
});
