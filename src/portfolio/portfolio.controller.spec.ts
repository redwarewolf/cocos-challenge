import { Test, TestingModule } from '@nestjs/testing';
import { PortfolioController } from './portfolio.controller';
import { PortfolioService } from './portfolio.service';

describe('PortfolioController', () => {
  let controller: PortfolioController;

  const portfolioService = { getPortfolio: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PortfolioController],
      providers: [{ provide: PortfolioService, useValue: portfolioService }],
    }).compile();

    controller = module.get(PortfolioController);
  });

  it('getPortfolio() delega en PortfolioService.getPortfolio() con el userId parseado', async () => {
    const portfolio = {
      userId: 1,
      availableCash: 100,
      positions: [],
      totalAccountValue: 100,
    };
    portfolioService.getPortfolio.mockResolvedValue(portfolio);

    const result = await controller.getPortfolio(1);

    expect(portfolioService.getPortfolio).toHaveBeenCalledWith(1);
    expect(result).toBe(portfolio);
  });
});
