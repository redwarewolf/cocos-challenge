import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { QueryFailedError } from 'typeorm';
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
import { OrdersService } from './orders.service';

describe('OrdersService (functional: envío de órdenes)', () => {
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
    create: jest.fn((data: Partial<Order>) => data),
    save: jest.fn(
      (order: Partial<Order>) =>
        Promise.resolve({ id: 100, ...order }) as Promise<Order>,
    ),
    findOne: jest.fn(),
    findAndCount: jest.fn(),
  };
  const valuationService = {
    getLastClose: jest.fn(),
    getAvailableCash: jest.fn(),
    getAvailableQuantity: jest.fn(),
    getCashInstrument: jest.fn(),
  };

  // `create()` corre dentro de dataSource.transaction(); acá simulamos ese wrapper
  // devolviendo un `manager` fake cuyo getRepository(Order) es el mismo mock de arriba,
  // para poder seguir asertando sobre orderRepository.save sin levantar una DB real.
  const transactionalManager = {
    query: jest.fn().mockResolvedValue(undefined),
    getRepository: jest.fn().mockReturnValue(orderRepository),
  };
  const dataSource = {
    transaction: jest.fn(
      (cb: (manager: typeof transactionalManager) => Promise<Order>) =>
        cb(transactionalManager),
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
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    service = module.get(OrdersService);
  });

  describe('create', () => {
    it('llena una orden MARKET al último close cuando hay fondos suficientes', async () => {
      valuationService.getLastClose.mockResolvedValue(900);
      valuationService.getAvailableCash.mockResolvedValue(100_000);

      const order = await service.create({
        userId: 1,
        instrumentId: 34,
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        size: 10,
      });

      expect(order.status).toBe(OrderStatus.FILLED);
      expect(order.price).toBe('900.00');
      expect(order.size).toBe(10);
    });

    it('toma el advisory lock por userId antes de leer disponible y guardar la orden', async () => {
      valuationService.getLastClose.mockResolvedValue(900);
      valuationService.getAvailableCash.mockResolvedValue(100_000);

      await service.create({
        userId: 7,
        instrumentId: 34,
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        size: 1,
      });

      expect(dataSource.transaction).toHaveBeenCalled();
      expect(transactionalManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1)',
        [7],
      );
      // el lock se pide antes de consultar el disponible / guardar la orden
      const lockCallOrder =
        transactionalManager.query.mock.invocationCallOrder[0];
      const availableCashCallOrder =
        valuationService.getAvailableCash.mock.invocationCallOrder[0];
      expect(lockCallOrder).toBeLessThan(availableCashCallOrder);
    });

    it('calcula el size a partir de "amount", redondeando hacia abajo sin fracciones', async () => {
      valuationService.getLastClose.mockResolvedValue(900);
      valuationService.getAvailableCash.mockResolvedValue(100_000);

      const order = await service.create({
        userId: 1,
        instrumentId: 34,
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        amount: 5000,
      });

      expect(order.size).toBe(5); // floor(5000 / 900) = 5
    });

    it('rechaza (400) si el "amount" no alcanza para comprar ni una acción', async () => {
      valuationService.getLastClose.mockResolvedValue(900);

      await expect(
        service.create({
          userId: 1,
          instrumentId: 34,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          amount: 100,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('persiste la orden como REJECTED si no hay fondos suficientes para un BUY', async () => {
      valuationService.getLastClose.mockResolvedValue(900);
      valuationService.getAvailableCash.mockResolvedValue(1000);

      const order = await service.create({
        userId: 1,
        instrumentId: 34,
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        size: 10,
      });

      expect(order.status).toBe(OrderStatus.REJECTED);
      expect(orderRepository.save).toHaveBeenCalled();
    });

    it('persiste la orden como REJECTED si no hay tenencia suficiente para un SELL', async () => {
      valuationService.getAvailableQuantity.mockResolvedValue(5);
      valuationService.getLastClose.mockResolvedValue(900);

      const order = await service.create({
        userId: 1,
        instrumentId: 34,
        side: OrderSide.SELL,
        type: OrderType.MARKET,
        size: 10,
      });

      expect(order.status).toBe(OrderStatus.REJECTED);
    });

    it('deja una orden LIMIT como NEW usando el precio enviado, no el de mercado', async () => {
      valuationService.getAvailableCash.mockResolvedValue(100_000);

      const order = await service.create({
        userId: 1,
        instrumentId: 34,
        side: OrderSide.BUY,
        type: OrderType.LIMIT,
        size: 10,
        price: 500,
      });

      expect(order.status).toBe(OrderStatus.NEW);
      expect(order.price).toBe('500.00');
      expect(valuationService.getLastClose).not.toHaveBeenCalled();
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
      expect(orderRepository.save).toHaveBeenCalled();
    });

    it('toma el advisory lock por userId', async () => {
      valuationService.getAvailableCash.mockResolvedValue(100000);

      await service.createCashMovement({
        userId: 9,
        side: OrderSide.CASH_IN,
        amount: 1000,
      });

      expect(transactionalManager.query).toHaveBeenCalledWith(
        'SELECT pg_advisory_xact_lock($1)',
        [9],
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

  describe('idempotencia (issue #8)', () => {
    beforeEach(() => {
      valuationService.getLastClose.mockResolvedValue(900);
      valuationService.getAvailableCash.mockResolvedValue(100_000);
    });

    it('sin Idempotency-Key, crea la orden normalmente con idempotencyKey null', async () => {
      const order = await service.create({
        userId: 1,
        instrumentId: 34,
        side: OrderSide.BUY,
        type: OrderType.MARKET,
        size: 10,
      });

      expect(orderRepository.findOne).not.toHaveBeenCalled();
      expect(order.idempotencyKey).toBeNull();
    });

    it('con una Idempotency-Key nunca vista, crea la orden y la guarda con esa key', async () => {
      orderRepository.findOne.mockResolvedValue(null);

      const order = await service.create(
        {
          userId: 1,
          instrumentId: 34,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          size: 10,
        },
        'key-1',
      );

      expect(orderRepository.findOne).toHaveBeenCalledWith({
        where: { idempotencyKey: 'key-1' },
      });
      expect(order.idempotencyKey).toBe('key-1');
      expect(dataSource.transaction).toHaveBeenCalled();
    });

    it('reintento con la misma Idempotency-Key devuelve la orden ya creada, sin duplicar', async () => {
      const existing = { id: 100, idempotencyKey: 'key-1' } as Order;
      orderRepository.findOne.mockResolvedValue(existing);

      const order = await service.create(
        {
          userId: 1,
          instrumentId: 34,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          size: 10,
        },
        'key-1',
      );

      expect(order).toBe(existing);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });

    it('dos requests concurrentes con la misma key: la que pierde la carrera de UNIQUE devuelve la fila ganadora en vez de fallar', async () => {
      const winner = { id: 100, idempotencyKey: 'key-1' } as Order;
      orderRepository.findOne
        .mockResolvedValueOnce(null) // chequeo inicial: todavía no existe
        .mockResolvedValueOnce(winner); // se recupera después del choque de UNIQUE

      const uniqueViolation = new QueryFailedError('INSERT ...', [], {
        code: '23505',
      } as never);
      dataSource.transaction.mockImplementationOnce(() =>
        Promise.reject(uniqueViolation),
      );

      const order = await service.create(
        {
          userId: 1,
          instrumentId: 34,
          side: OrderSide.BUY,
          type: OrderType.MARKET,
          size: 10,
        },
        'key-1',
      );

      expect(order).toBe(winner);
    });

    it('propaga otros errores de transacción sin tratarlos como duplicado', async () => {
      orderRepository.findOne.mockResolvedValue(null);
      dataSource.transaction.mockImplementationOnce(() =>
        Promise.reject(new Error('boom')),
      );

      await expect(
        service.create(
          {
            userId: 1,
            instrumentId: 34,
            side: OrderSide.BUY,
            type: OrderType.MARKET,
            size: 10,
          },
          'key-1',
        ),
      ).rejects.toThrow('boom');
    });

    it('createCashMovement también respeta la Idempotency-Key', async () => {
      valuationService.getCashInstrument.mockResolvedValue(cash);
      const existing = { id: 200, idempotencyKey: 'cash-key' } as Order;
      orderRepository.findOne.mockResolvedValue(existing);

      const order = await service.createCashMovement(
        { userId: 1, side: OrderSide.CASH_IN, amount: 1000 },
        'cash-key',
      );

      expect(order).toBe(existing);
      expect(dataSource.transaction).not.toHaveBeenCalled();
    });
  });
});
