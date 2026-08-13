import { Test, TestingModule } from '@nestjs/testing';
import { OrderSide, OrderType } from '../database/entities/order.entity';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

describe('OrdersController', () => {
  let controller: OrdersController;

  const ordersService = {
    create: jest.fn(),
    createCashMovement: jest.fn(),
    findAll: jest.fn(),
    cancel: jest.fn(),
  };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [OrdersController],
      providers: [{ provide: OrdersService, useValue: ordersService }],
    }).compile();

    controller = module.get(OrdersController);
  });

  it('create() delega en OrdersService.create() con el DTO recibido', async () => {
    const dto: CreateOrderDto = {
      userId: 1,
      instrumentId: 34,
      side: OrderSide.BUY,
      type: OrderType.MARKET,
      size: 10,
    };
    const created = { id: 1, ...dto, status: 'FILLED' };
    ordersService.create.mockResolvedValue(created);

    const result = await controller.create(dto);

    expect(ordersService.create).toHaveBeenCalledWith(dto);
    expect(result).toBe(created);
  });

  it('createCashMovement() delega en OrdersService.createCashMovement() con el DTO recibido', async () => {
    const dto: CreateCashMovementDto = {
      userId: 1,
      side: OrderSide.CASH_IN,
      amount: 100000,
    };
    const created = { id: 2, ...dto, status: 'FILLED' };
    ordersService.createCashMovement.mockResolvedValue(created);

    const result = await controller.createCashMovement(dto);

    expect(ordersService.createCashMovement).toHaveBeenCalledWith(dto);
    expect(result).toBe(created);
  });

  it('findAll() delega en OrdersService.findAll() con el query recibido', async () => {
    const page = { data: [], total: 0, page: 1, limit: 20 };
    ordersService.findAll.mockResolvedValue(page);

    const result = await controller.findAll({ userId: 1 });

    expect(ordersService.findAll).toHaveBeenCalledWith({ userId: 1 });
    expect(result).toBe(page);
  });

  it('cancel() delega en OrdersService.cancel() con el id parseado', async () => {
    const cancelled = { id: 5, status: 'CANCELLED' };
    ordersService.cancel.mockResolvedValue(cancelled);

    const result = await controller.cancel(5);

    expect(ordersService.cancel).toHaveBeenCalledWith(5);
    expect(result).toBe(cancelled);
  });
});
