import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdvisoryLock } from '../database/advisory-lock';
import {
  Order,
  OrderSide,
  OrderStatus,
  OrderType,
} from '../database/entities/order.entity';
import { IdempotentOrderWriter, OrderData } from './idempotent-order-writer';

describe('IdempotentOrderWriter', () => {
  let writer: IdempotentOrderWriter;

  const sampleData: OrderData = {
    userId: 1,
    instrumentId: 34,
    side: OrderSide.BUY,
    type: OrderType.MARKET,
    size: 10,
    price: '900.00',
    status: OrderStatus.FILLED,
  };

  const orderRepository = {
    create: jest.fn((data: Partial<Order>) => data),
    save: jest.fn(
      (order: Partial<Order>) =>
        Promise.resolve({ id: 100, ...order }) as Promise<Order>,
    ),
    findOne: jest.fn(),
  };

  // Mock encadenable de `manager.createQueryBuilder().insert().into(Order).values(...)
  // .orIgnore().execute()`, que usa saveOrder cuando viene una Idempotency-Key.
  const insertQueryBuilder = {
    insert: jest.fn().mockReturnThis(),
    into: jest.fn().mockReturnThis(),
    values: jest.fn().mockReturnThis(),
    orIgnore: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue(undefined),
  };

  const transactionalManager = {
    getRepository: jest.fn().mockReturnValue(orderRepository),
    createQueryBuilder: jest.fn().mockReturnValue(insertQueryBuilder),
  };

  const advisoryLock = {
    withLock: jest.fn(
      (
        _userId: number,
        fn: (manager: typeof transactionalManager) => Promise<Order>,
      ) => fn(transactionalManager),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdempotentOrderWriter,
        { provide: getRepositoryToken(Order), useValue: orderRepository },
        { provide: AdvisoryLock, useValue: advisoryLock },
      ],
    }).compile();

    writer = module.get(IdempotentOrderWriter);
  });

  it('sin Idempotency-Key, crea la orden normalmente con idempotencyKey null', async () => {
    const order = await writer.write(undefined, 1, () =>
      Promise.resolve(sampleData),
    );

    expect(orderRepository.findOne).not.toHaveBeenCalled();
    expect(advisoryLock.withLock).toHaveBeenCalledWith(1, expect.any(Function));
    expect(order.idempotencyKey).toBeNull();
  });

  it('con una Idempotency-Key nunca vista, ejecuta computeData bajo el lock y guarda con esa key', async () => {
    const created = { id: 100, idempotencyKey: 'key-1' } as Order;
    orderRepository.findOne
      .mockResolvedValueOnce(null) // chequeo inicial: todavía no existe
      .mockResolvedValueOnce(created); // se relee después de insertar

    const order = await writer.write('key-1', 1, () =>
      Promise.resolve(sampleData),
    );

    expect(orderRepository.findOne).toHaveBeenCalledWith({
      where: { idempotencyKey: 'key-1' },
    });
    expect(orderRepository.findOne).toHaveBeenCalledTimes(2);
    expect(advisoryLock.withLock).toHaveBeenCalled();
    expect(insertQueryBuilder.orIgnore).toHaveBeenCalled();
    expect(order).toBe(created);
  });

  it('reintento con la misma Idempotency-Key devuelve la orden ya creada, sin tomar el lock', async () => {
    const existing = { id: 100, idempotencyKey: 'key-1' } as Order;
    orderRepository.findOne.mockResolvedValue(existing);

    const order = await writer.write('key-1', 1, () =>
      Promise.resolve(sampleData),
    );

    expect(order).toBe(existing);
    expect(advisoryLock.withLock).not.toHaveBeenCalled();
  });

  it('si el ON CONFLICT DO NOTHING se activa (perdimos la carrera), devuelve la fila ganadora', async () => {
    const winner = { id: 999, idempotencyKey: 'key-1' } as Order;
    orderRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(winner);

    const order = await writer.write('key-1', 1, () =>
      Promise.resolve(sampleData),
    );

    expect(order).toBe(winner);
    expect(orderRepository.save).not.toHaveBeenCalled();
  });

  it('lanza si tras el insert (con orIgnore) no se encuentra ninguna fila con la key', async () => {
    orderRepository.findOne.mockResolvedValue(null); // nunca aparece, ni antes ni después

    await expect(
      writer.write('key-1', 1, () => Promise.resolve(sampleData)),
    ).rejects.toThrow(/No se pudo crear ni encontrar la orden/);
  });

  it('propaga errores de computeData/lock sin tratarlos como duplicado', async () => {
    orderRepository.findOne.mockResolvedValue(null);
    advisoryLock.withLock.mockImplementationOnce(() =>
      Promise.reject(new Error('boom')),
    );

    await expect(
      writer.write('key-1', 1, () => Promise.resolve(sampleData)),
    ).rejects.toThrow('boom');
  });
});
