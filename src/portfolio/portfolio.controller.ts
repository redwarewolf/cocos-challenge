import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { Portfolio } from '../valuation/valuation.types';
import { PortfolioService } from './portfolio.service';

@Controller('portfolio')
export class PortfolioController {
  constructor(private readonly portfolioService: PortfolioService) {}

  @Get(':userId')
  getPortfolio(
    @Param('userId', ParseIntPipe) userId: number,
  ): Promise<Portfolio> {
    return this.portfolioService.getPortfolio(userId);
  }
}
