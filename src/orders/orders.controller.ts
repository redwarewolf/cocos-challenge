import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { Order } from '../database/entities/order.entity';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.ordersService.create(dto);
  }

  @Post('cash')
  createCashMovement(@Body() dto: CreateCashMovementDto): Promise<Order> {
    return this.ordersService.createCashMovement(dto);
  }

  @Patch(':id/cancel')
  cancel(@Param('id', ParseIntPipe) id: number): Promise<Order> {
    return this.ordersService.cancel(id);
  }
}
