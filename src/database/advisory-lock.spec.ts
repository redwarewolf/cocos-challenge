import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { AdvisoryLock } from './advisory-lock';

describe('AdvisoryLock', () => {
  let advisoryLock: AdvisoryLock;

  const transactionalManager = {
    query: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    transaction: jest.fn(
      (cb: (manager: typeof transactionalManager) => unknown) =>
        cb(transactionalManager),
    ),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AdvisoryLock,
        { provide: getDataSourceToken(), useValue: dataSource },
      ],
    }).compile();

    advisoryLock = module.get(AdvisoryLock);
  });

  it('toma el lock con la key correcta antes de ejecutar fn', async () => {
    const fn = jest.fn().mockResolvedValue('result');

    const result = await advisoryLock.withLock(7, fn);

    expect(dataSource.transaction).toHaveBeenCalled();
    expect(transactionalManager.query).toHaveBeenCalledWith(
      'SELECT pg_advisory_xact_lock($1)',
      [7],
    );
    expect(fn).toHaveBeenCalledWith(transactionalManager);
    expect(result).toBe('result');
  });

  it('pide el lock antes de invocar fn (orden de operaciones)', async () => {
    const fn = jest.fn().mockResolvedValue(undefined);

    await advisoryLock.withLock(1, fn);

    const lockCallOrder =
      transactionalManager.query.mock.invocationCallOrder[0];
    const fnCallOrder = fn.mock.invocationCallOrder[0];
    expect(lockCallOrder).toBeLessThan(fnCallOrder);
  });

  it('propaga lo que devuelve fn', async () => {
    const fn = jest.fn().mockResolvedValue({ id: 5 });

    const result = await advisoryLock.withLock(2, fn);

    expect(result).toEqual({ id: 5 });
  });

  it('propaga errores de fn sin capturarlos', async () => {
    const fn = jest.fn().mockRejectedValue(new Error('boom'));

    await expect(advisoryLock.withLock(3, fn)).rejects.toThrow('boom');
  });
});
