import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { AdvisoryLock, LockNamespace } from '../database/advisory-lock';
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
        _namespace: LockNamespace,
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
    expect(advisoryLock.withLock).toHaveBeenCalledWith(
      LockNamespace.USER,
      1,
      expect.any(Function),
    );
    expect(order.idempotencyKey).toBeNull();
  });

  it('con una Idempotency-Key nunca vista, ejecuta computeData bajo el lock y guarda con esa key', async () => {
    const created = { id: 100, idempotencyKey: 'key-1' } as Order;
    orderRepository.findOne
      .mockResolvedValueOnce(null) // antes del lock: todavía no existe
      .mockResolvedValueOnce(null) // bajo el lock: sigue sin existir
      .mockResolvedValueOnce(created); // se relee después de insertar

    const order = await writer.write('key-1', 1, () =>
      Promise.resolve(sampleData),
    );

    expect(orderRepository.findOne).toHaveBeenCalledWith({
      where: { userId: 1, idempotencyKey: 'key-1' },
    });
    expect(orderRepository.findOne).toHaveBeenCalledTimes(3);
    expect(advisoryLock.withLock).toHaveBeenCalled();
    expect(insertQueryBuilder.orIgnore).toHaveBeenCalled();
    expect(order).toBe(created);
  });

  it('un reintento concurrente devuelve la orden original en vez de recalcularla', async () => {
    // El request original todavía no commiteó cuando este chequea antes del lock, así que no
    // lo ve. Para cuando obtiene el lock —que se libera recién en el commit— la fila ya está.
    const original = {
      id: 100,
      idempotencyKey: 'key-1',
      status: OrderStatus.FILLED,
    } as Order;
    orderRepository.findOne
      .mockResolvedValueOnce(null) // antes del lock: la original sigue en vuelo
      .mockResolvedValueOnce(original); // bajo el lock: ya commiteó

    const computeData = jest.fn();

    const order = await writer.write('key-1', 1, computeData);

    expect(order).toBe(original);
    expect(computeData).not.toHaveBeenCalled();
  });

  it('el reintento concurrente no falla aunque el recálculo ya no sea posible', async () => {
    // El caso que hacía falla la idempotencia: entre el request original y el reintento el
    // precio se movió, así que recalcular tira 400 y el cliente recibía un error por una
    // orden que existe y quedó FILLED.
    const original = { id: 100, idempotencyKey: 'key-1' } as Order;
    orderRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(original);

    const computeData = jest.fn(() =>
      Promise.reject(
        new BadRequestException(
          '"amount" is not enough for at least one share at the current price',
        ),
      ),
    );

    await expect(writer.write('key-1', 1, computeData)).resolves.toBe(original);
  });

  it('reintento tardío devuelve la orden ya creada sin tomar el lock (fast path)', async () => {
    const existing = { id: 100, idempotencyKey: 'key-1' } as Order;
    orderRepository.findOne.mockResolvedValue(existing);

    const order = await writer.write('key-1', 1, () =>
      Promise.resolve(sampleData),
    );

    expect(order).toBe(existing);
    expect(advisoryLock.withLock).not.toHaveBeenCalled();
  });

  it('si el ON CONFLICT DO NOTHING se activa (perdimos la carrera), devuelve la fila ganadora', async () => {
    // La carrera se pierde después de los dos lookups: la fila ganadora se insertó entre el
    // chequeo bajo el lock y el insert propio.
    const winner = { id: 999, idempotencyKey: 'key-1' } as Order;
    orderRepository.findOne
      .mockResolvedValueOnce(null)
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

  it('la key se busca scopeada por usuario, no globalmente', async () => {
    // La misma key mandada por otro usuario no debe resolver contra la orden ajena: si el
    // findOne no filtrara por userId, el usuario 2 recibiría la orden del usuario 1, con
    // instrumento, size y precio que no son suyos.
    const created = { id: 200, userId: 2, idempotencyKey: 'key-1' } as Order;
    orderRepository.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(created);

    const order = await writer.write('key-1', 2, () =>
      Promise.resolve({ ...sampleData, userId: 2 }),
    );

    // Los tres lookups van scopeados: el de antes del lock, el de adentro, y la relectura
    // posterior al ON CONFLICT DO NOTHING. Si alguno buscara solo por key, este usuario
    // recibiría la orden de otro.
    for (const n of [1, 2, 3]) {
      expect(orderRepository.findOne).toHaveBeenNthCalledWith(n, {
        where: { userId: 2, idempotencyKey: 'key-1' },
      });
    }
    expect(order).toBe(created);
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
