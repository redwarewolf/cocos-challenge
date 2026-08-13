import {
  Body,
  Controller,
  Get,
  Headers,
  Param,
  ParseIntPipe,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  ApiHeader,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  Paginated,
  PaginatedResponseDto,
} from '../common/dto/paginated-response.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { OrderResponseDto } from './dto/order-response.dto';
import { OrdersService } from './orders.service';

@ApiTags('orders')
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post()
  @ApiOperation({ summary: 'Envía una orden de compra/venta (MARKET o LIMIT)' })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Si se repite un request con la misma key, devuelve la orden ya creada en vez de duplicarla',
  })
  @ApiResponse({
    status: 201,
    description: 'Orden creada (FILLED, NEW o REJECTED según corresponda)',
    type: OrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Input inválido' })
  @ApiResponse({
    status: 404,
    description: 'Usuario o instrumento inexistente',
  })
  create(
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.create(dto, idempotencyKey);
  }

  @Post('cash')
  @ApiOperation({
    summary:
      'Deposita (CASH_IN) o retira (CASH_OUT) pesos de la cuenta de un usuario',
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Si se repite un request con la misma key, devuelve el movimiento ya creado en vez de duplicarlo',
  })
  @ApiResponse({
    status: 201,
    description: 'Movimiento creado (FILLED o REJECTED)',
    type: OrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'Input inválido' })
  @ApiResponse({ status: 404, description: 'Usuario inexistente' })
  createCashMovement(
    @Body() dto: CreateCashMovementDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<OrderResponseDto> {
    return this.ordersService.createCashMovement(dto, idempotencyKey);
  }

  @Get()
  @ApiOperation({
    summary:
      'Historial de órdenes/movimientos de un usuario (más recientes primero)',
  })
  @ApiResponse({
    status: 200,
    description: 'Página del historial, opcionalmente filtrado por status',
    type: PaginatedResponseDto(OrderResponseDto),
  })
  @ApiResponse({
    status: 400,
    description: 'Falta userId, o page/limit/status inválidos',
  })
  @ApiResponse({ status: 404, description: 'Usuario inexistente' })
  findAll(
    @Query() query: ListOrdersQueryDto,
  ): Promise<Paginated<OrderResponseDto>> {
    return this.ordersService.findAll(query);
  }

  @Patch(':id/cancel')
  @ApiOperation({ summary: 'Cancela una orden en estado NEW' })
  @ApiParam({ name: 'id', example: 1 })
  @ApiResponse({
    status: 200,
    description: 'Orden cancelada',
    type: OrderResponseDto,
  })
  @ApiResponse({ status: 400, description: 'La orden no está en estado NEW' })
  @ApiResponse({ status: 404, description: 'Orden inexistente' })
  cancel(@Param('id', ParseIntPipe) id: number): Promise<OrderResponseDto> {
    return this.ordersService.cancel(id);
  }
}
