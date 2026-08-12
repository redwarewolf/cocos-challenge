import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Portfolio } from '../valuation/valuation.types';
import { PortfolioService } from './portfolio.service';

@ApiTags('portfolio')
@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get(':userId')
  @ApiOperation({
    summary:
      'Valor total de cuenta, pesos disponibles y posiciones de un usuario',
  })
  @ApiParam({ name: 'userId', example: 1 })
  @ApiResponse({ status: 200, description: 'Portfolio del usuario' })
  @ApiResponse({ status: 404, description: 'Usuario inexistente' })
  getPortfolio(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Portfolio> {
    return this.portfolioService.getPortfolio(userId);
  }
}
