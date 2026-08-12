import {
  Body,
  Controller,
  Param,
  ParseIntPipe,
  Patch,
  Post,
} from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Order } from '../database/entities/order.entity';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Envía una orden de compra/venta (MARKET o LIMIT)' })
  @ApiResponse({
    status: 201,
    description: 'Orden creada (FILLED, NEW o REJECTED según corresponda)',
  })
  @ApiResponse({ status: 400, description: 'Input inválido' })
  @ApiResponse({
    status: 404,
    description: 'Usuario o instrumento inexistente',
  })
  create(@Body() dto: CreateOrderDto): Promise<Order> {
    return this.ordersService.create(dto);
  }

  @Post('cash')
  @ApiOperation({
    summary:
      'Deposita (CASH_IN) o retira (CASH_OUT) pesos de la cuenta de un usuario',
  })
  @ApiResponse({
    status: 201,
    description: 'Movimiento creado (FILLED o REJECTED)',
  })
  @ApiResponse({ status: 400, description: 'Input inválido' })
  @ApiResponse({ status: 404, description: 'Usuario inexistente' })
  createCashMovement(@Body() dto: CreateCashMovementDto): Promise<Order> {
    return this.ordersService.createCashMovement(dto);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancela una orden en estado NEW' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({ status: 200, description: 'Orden cancelada' })
  @ApiResponse({ status: 400, description: 'La orden no está en estado NEW' })
  @ApiResponse({ status: 404, description: 'Orden inexistente' })
  cancel(@Param('id', ParseIntPipe) id: number): Promise<Order> {
    return this.ordersService.cancel(id);
  }
}
