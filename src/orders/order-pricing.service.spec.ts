import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { EntityManager } from 'typeorm';
import {
  OrderSide,
  OrderStatus,
  OrderType,
} from '../database/entities/order.entity';
import { ValuationService } from '../valuation/valuation.service';
import { OrderPricingService } from './order-pricing.service';

describe('OrderPricingService', () => {
  let service: OrderPricingService;

  // resolvePrice/resolveStatus solo reenvían el manager a ValuationService (mockeado
  // acá), nunca operan sobre él directamente — un objeto vacío alcanza.
  const manager = {} as EntityManager;

  const valuationService = {
    getLastClose: jest.fn(),
    getAvailableCash: jest.fn(),
    getAvailableQuantity: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrderPricingService,
        { provide: ValuationService, useValue: valuationService },
      ],
    }).compile();

    service = module.get(OrderPricingService);
  });

  describe('resolvePrice', () => {
    it('LIMIT: usa el price del dto, redondeado a 2 decimales', async () => {
      const price = await service.resolvePrice(
        { type: OrderType.LIMIT, price: 500.005 } as never,
        manager,
      );

      expect(price).toBe(500.01);
      expect(valuationService.getLastClose).not.toHaveBeenCalled();
    });

    it('MARKET: usa el último close', async () => {
      valuationService.getLastClose.mockResolvedValue(900);

      const price = await service.resolvePrice(
        { type: OrderType.MARKET, instrumentId: 34 } as never,
        manager,
      );

      expect(price).toBe(900);
      expect(valuationService.getLastClose).toHaveBeenCalledWith(34, manager);
    });

    it('MARKET: 400 si no hay marketdata para el instrumento', async () => {
      valuationService.getLastClose.mockResolvedValue(null);

      await expect(
        service.resolvePrice(
          { type: OrderType.MARKET, instrumentId: 999 } as never,
          manager,
        ),
      ).rejects.toThrow(BadRequestException);
    });
  });

  describe('resolveSize', () => {
    it('usa size directamente si viene en el dto', () => {
      expect(service.resolveSize({ size: 10 } as never, 900)).toBe(10);
    });

    it('calcula size = floor(amount / price) si no viene size', () => {
      expect(service.resolveSize({ amount: 5000 } as never, 900)).toBe(5);
    });

    it('400 si el amount no alcanza ni para una acción', () => {
      expect(() => service.resolveSize({ amount: 100 } as never, 900)).toThrow(
        BadRequestException,
      );
    });

    it('el mensaje de error no habla de comprar: resolveSize es común a BUY y SELL', () => {
      // Un SELL por monto insuficiente recibía "not enough to buy at least one share",
      // que describe la operación contraria a la que el cliente pidió.
      expect(() =>
        service.resolveSize(
          { side: OrderSide.SELL, amount: 100 } as never,
          900,
        ),
      ).toThrow(/^(?!.*\bbuy\b).*amount.*$/i);
    });
  });

  describe('resolveStatus', () => {
    it('BUY: FILLED (MARKET) si hay fondos suficientes', async () => {
      valuationService.getAvailableCash.mockResolvedValue(100_000);

      const status = await service.resolveStatus(
        { side: OrderSide.BUY, type: OrderType.MARKET, userId: 1 } as never,
        10,
        900,
        manager,
      );

      expect(status).toBe(OrderStatus.FILLED);
    });

    it('BUY: NEW (LIMIT) si hay fondos suficientes', async () => {
      valuationService.getAvailableCash.mockResolvedValue(100_000);

      const status = await service.resolveStatus(
        { side: OrderSide.BUY, type: OrderType.LIMIT, userId: 1 } as never,
        10,
        900,
        manager,
      );

      expect(status).toBe(OrderStatus.NEW);
    });

    it('BUY: REJECTED si no hay fondos suficientes', async () => {
      valuationService.getAvailableCash.mockResolvedValue(1000);

      const status = await service.resolveStatus(
        { side: OrderSide.BUY, type: OrderType.MARKET, userId: 1 } as never,
        10,
        900,
        manager,
      );

      expect(status).toBe(OrderStatus.REJECTED);
    });

    it('SELL: REJECTED si no hay tenencia suficiente', async () => {
      valuationService.getAvailableQuantity.mockResolvedValue(5);

      const status = await service.resolveStatus(
        {
          side: OrderSide.SELL,
          type: OrderType.MARKET,
          userId: 1,
          instrumentId: 34,
        },
        10,
        900,
        manager,
      );

      expect(status).toBe(OrderStatus.REJECTED);
      expect(valuationService.getAvailableCash).not.toHaveBeenCalled();
    });

    it('SELL: FILLED si hay tenencia suficiente', async () => {
      valuationService.getAvailableQuantity.mockResolvedValue(50);

      const status = await service.resolveStatus(
        {
          side: OrderSide.SELL,
          type: OrderType.MARKET,
          userId: 1,
          instrumentId: 34,
        },
        10,
        900,
        manager,
      );

      expect(status).toBe(OrderStatus.FILLED);
    });
  });
});
