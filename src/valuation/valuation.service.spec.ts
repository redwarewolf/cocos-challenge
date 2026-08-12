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
    it('calcula marketValue y performancePct a partir de quantity/netCost/lastClose', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 47,
          ticker: 'PAMP',
          name: 'Pampa Holding S.A.',
          quantity: '40',
          netCost: '37100.00',
          lastClose: '925.85',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.instrumentId).toBe(47);
      expect(position.quantity).toBe(40);
      expect(position.totalCost).toBe(37100);
      expect(position.marketValue).toBeCloseTo(37034, 5);
      expect(position.performancePct).toBeCloseTo(-0.177897, 5);
    });

    it('performancePct es 0 cuando totalCost es <= 0 (evita división por cero)', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '10',
          netCost: '0.00',
          lastClose: '100',
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.performancePct).toBe(0);
    });

    it('marketValue es 0 si el instrumento no tiene marketdata (lastClose null)', async () => {
      queryFn.mockResolvedValue([
        {
          instrumentId: 1,
          ticker: 'X',
          name: 'X',
          quantity: '10',
          netCost: '1000.00',
          lastClose: null,
        },
      ]);

      const [position] = await service.getPositions(1);

      expect(position.marketValue).toBe(0);
      expect(position.performancePct).toBe(-100);
    });

    it('devuelve [] si el usuario no tiene posiciones', async () => {
      queryFn.mockResolvedValue([]);

      const positions = await service.getPositions(1);

      expect(positions).toEqual([]);
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
            netCost: '37100.00',
            lastClose: '925.85',
          },
        ]); // getPositions

      const portfolio = await service.getPortfolio(1);

      expect(portfolio.userId).toBe(1);
      expect(portfolio.availableCash).toBe(748571);
      expect(portfolio.positions).toHaveLength(1);
      expect(portfolio.totalAccountValue).toBeCloseTo(748571 + 37034, 5);
    });

    it('totalAccountValue = availableCash cuando no hay posiciones', async () => {
      queryFn
        .mockResolvedValueOnce([{ available: '0' }])
        .mockResolvedValueOnce([]);

      const portfolio = await service.getPortfolio(2);

      expect(portfolio.availableCash).toBe(0);
      expect(portfolio.positions).toEqual([]);
      expect(portfolio.totalAccountValue).toBe(0);
    });
  });
});
