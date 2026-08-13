import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { EntityManager } from 'typeorm';
import {
  Instrument,
  InstrumentType,
} from '../database/entities/instrument.entity';
import {
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
} from '../database/entities/order.entity';
import { User } from '../database/entities/user.entity';
import { ValuationService } from '../valuation/valuation.service';
import { IdempotentOrderWriter, OrderData } from './idempotent-order-writer';
import { OrderPricingService } from './order-pricing.service';
import { OrdersService } from './orders.service';

describe('OrdersService (orquestación: valida input, delega en los colaboradores)', () => {
  let service: OrdersService;

  const user: User = { id: 1, email: 'user@test.com', accountNumber: '10001' };
  const stock: Instrument = {
    id: 34,
    ticker: 'GGAL',
    name: 'Grupo Financiero Galicia',
    type: InstrumentType.ACCIONES,
  };
  const cash: Instrument = {
    id: 66,
    ticker: 'ARS',
    name: 'PESOS',
    type: InstrumentType.MONEDA,
  };

  const userRepository = { findOne: jest.fn() };
  const instrumentRepository = { findOne: jest.fn() };
  const orderRepository = {
    findOne: jest.fn(),
    findAndCount: jest.fn(),
    save: jest.fn(
      (order: Partial<Order>) => Promise.resolve(order) as Promise<Order>,
    ),
  };
  const valuationService = {
    getAvailableCash: jest.fn(),
    getCashInstrument: jest.fn(),
  };
  const orderPricing = {
    resolvePrice: jest.fn(),
    resolveSize: jest.fn(),
    resolveStatus: jest.fn(),
  };
  // Invoca computeData de verdad (como haría el real), para poder asertar qué le
  // termina llegando desde OrdersService — pero sin nada de lock/idempotencia real.
  const idempotentOrderWriter = {
    write: jest.fn(
      async (
        idempotencyKey: string | undefined,
        _userId: number,
        computeData: (manager: EntityManager) => Promise<OrderData>,
      ) => {
        const data = await computeData({} as EntityManager);
        return {
          id: 100,
          idempotencyKey: idempotencyKey ?? null,
          ...data,
        } as Order;
      },
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();
    userRepository.findOne.mockResolvedValue(user);
    instrumentRepository.findOne.mockResolvedValue(stock);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrdersService,
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: getRepositoryToken(User), useValue: userRepository },
        {
          provide: getRepositoryToken(Instrument),
          useValue: instrumentRepository,
        },
        { provide: ValuationService, useValue: valuationService },
        { provide: OrderPricingService, useValue: orderPricing },
        { provide: IdempotentOrderWriter, useValue: idempotentOrderWriter },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  describe('create', () => {
    it('rechaza (400) side distinto de BUY/SELL (ej. CASH_IN)', async () => {
      await expect(
        service.create({
          userId: 1,
          instrumentId: 66,
          side: OrderSide.CASH_IN,
          type: OrderType.MARKET,
          size: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza (400) si se envían "size" y "amount" juntos', async () => {
      await expect(
        service.create({
          userId: 1,
          instrumentId: 34,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          size: 10,
          amount: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza (400) una orden LIMIT sin "price"', async () => {
      await expect(
        service.create({
          userId: 1,
          instrumentId: 34,
          side: OrderSide.BUY,
          type: OrderType.LIMIT,
          size: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('rechaza (400) operar sobre el instrumento MONEDA', async () => {
      instrumentRepository.findOne.mockResolvedValue(cash);

      await expect(
        service.create({
          userId: 1,
          instrumentId: 66,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          size: 10,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('lanza 404 si el usuario no existe', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          userId: 999,
          instrumentId: 34,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          size: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('lanza 404 si el instrumento no existe', async () => {
      instrumentRepository.findOne.mockResolvedValue(null);

      await expect(
        service.create({
          userId: 1,
          instrumentId: 999,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          size: 10,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('encadena resolvePrice -> resolveSize -> resolveStatus, pasando el price resuelto a cada paso siguiente', async () => {
      orderPricing.resolvePrice.mockResolvedValue(500.01);
      orderPricing.resolveSize.mockReturnValue(10);
      orderPricing.resolveStatus.mockResolvedValue(OrderStatus.NEW);

      const order = await service.create({
        userId: 1,
        instrumentId: 34,
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        size: 10,
        price: 500.005,
      });

      expect(orderPricing.resolveSize).toHaveBeenCalledWith(
        expect.anything(),
        500.01,
      );
      expect(orderPricing.resolveStatus).toHaveBeenCalledWith(
        expect.anything(),
        10,
        500.01,
        expect.anything(),
      );
      expect(order.price).toBe('500.01');
      expect(order.status).toBe(OrderStatus.NEW);
    });

    it('delega en idempotentOrderWriter.write con el userId y la Idempotency-Key recibidos', async () => {
      orderPricing.resolvePrice.mockResolvedValue(900);
      orderPricing.resolveSize.mockReturnValue(10);
      orderPricing.resolveStatus.mockResolvedValue(OrderStatus.FILLED);

      await service.create(
        {
          userId: 7,
          instrumentId: 34,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          size: 10,
        },
        'key-1',
      );

      expect(idempotentOrderWriter.write).toHaveBeenCalledWith(
        'key-1',
        7,
        expect.any(Function),
      );
    });
  });

  describe('createCashMovement', () => {
    beforeEach(() => {
      valuationService.getCashInstrument.mockResolvedValue(cash);
    });

    it('un CASH_IN siempre se llena, sin importar el disponible actual', async () => {
      valuationService.getAvailableCash.mockResolvedValue(0);

      const order = await service.createCashMovement({
        userId: 1,
        side: OrderSide.CASH_IN,
        amount: 100000,
      });

      expect(order.status).toBe(OrderStatus.FILLED);
      expect(order.instrumentId).toBe(cash.id);
      expect(order.size).toBe(100000);
      expect(order.price).toBe('1.00');
    });

    it('un CASH_OUT se llena si hay disponible suficiente', async () => {
      valuationService.getAvailableCash.mockResolvedValue(100000);

      const order = await service.createCashMovement({
        userId: 1,
        side: OrderSide.CASH_OUT,
        amount: 50000,
      });

      expect(order.status).toBe(OrderStatus.FILLED);
    });

    it('un CASH_OUT queda REJECTED (pero se persiste) si no hay disponible suficiente', async () => {
      valuationService.getAvailableCash.mockResolvedValue(1000);

      const order = await service.createCashMovement({
        userId: 1,
        side: OrderSide.CASH_OUT,
        amount: 50000,
      });

      expect(order.status).toBe(OrderStatus.REJECTED);
    });

    it('delega en idempotentOrderWriter.write con el userId y la Idempotency-Key recibidos', async () => {
      valuationService.getAvailableCash.mockResolvedValue(100000);

      await service.createCashMovement(
        { userId: 9, side: OrderSide.CASH_IN, amount: 1000 },
        'cash-key',
      );

      expect(idempotentOrderWriter.write).toHaveBeenCalledWith(
        'cash-key',
        9,
        expect.any(Function),
      );
    });

    it('lanza 404 si el usuario no existe', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(
        service.createCashMovement({
          userId: 999,
          side: OrderSide.CASH_IN,
          amount: 1000,
        }),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('findAll', () => {
    it('lanza 404 si el usuario no existe', async () => {
      userRepository.findOne.mockResolvedValue(null);

      await expect(service.findAll({ userId: 999 })).rejects.toThrow(
        NotFoundException,
      );
    });

    it('filtra solo por userId cuando no se manda status', async () => {
      orderRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ userId: 1 });

      expect(orderRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: 1 } }),
      );
    });

    it('agrega el filtro de status cuando se manda', async () => {
      orderRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ userId: 1, status: OrderStatus.REJECTED });

      expect(orderRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 1, status: OrderStatus.REJECTED },
        }),
      );
    });

    it('ordena por datetime descendente (más reciente primero)', async () => {
      orderRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ userId: 1 });

      expect(orderRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ order: { datetime: 'DESC' } }),
      );
    });

    it('usa page=1 y limit=20 por default si no vienen en el query', async () => {
      orderRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ userId: 1 });

      expect(orderRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 0, take: 20 }),
      );
    });

    it('calcula skip/take a partir de page/limit', async () => {
      orderRepository.findAndCount.mockResolvedValue([[], 0]);

      await service.findAll({ userId: 1, page: 3, limit: 10 });

      expect(orderRepository.findAndCount).toHaveBeenCalledWith(
        expect.objectContaining({ skip: 20, take: 10 }),
      );
    });

    it('devuelve data/total desde findAndCount(), junto con page y limit', async () => {
      const orders = [{ id: 1 } as Order, { id: 2 } as Order];
      orderRepository.findAndCount.mockResolvedValue([orders, 15]);

      const result = await service.findAll({ userId: 1, page: 2, limit: 2 });

      expect(result).toEqual({ data: orders, total: 15, page: 2, limit: 2 });
    });
  });

  describe('cancel', () => {
    it('cancela una orden en estado NEW', async () => {
      orderRepository.findOne.mockResolvedValue({
        id: 5,
        status: OrderStatus.NEW,
      });

      const order = await service.cancel(5);

      expect(order.status).toBe(OrderStatus.CANCELLED);
    });

    it('rechaza (400) cancelar una orden que no está NEW', async () => {
      orderRepository.findOne.mockResolvedValue({
        id: 5,
        status: OrderStatus.FILLED,
      });

      await expect(service.cancel(5)).rejects.toThrow(BadRequestException);
    });

    it('lanza 404 al cancelar una orden inexistente', async () => {
      orderRepository.findOne.mockResolvedValue(null);

      await expect(service.cancel(999)).rejects.toThrow(NotFoundException);
    });
  });
});
