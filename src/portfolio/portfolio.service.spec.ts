import { NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { User } from '../database/entities/user.entity';
import { ValuationService } from '../valuation/valuation.service';
import { PortfolioService } from './portfolio.service';

describe('PortfolioService', () => {
  let service: PortfolioService;

  const userRepository = { findOne: jest.fn() };
  const valuationService = { getPortfolio: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PortfolioService,
        { provide: getRepositoryToken(User), useValue: userRepository },
        { provide: ValuationService, useValue: valuationService },
      ],
    }).compile();

    service = module.get(PortfolioService);
  });

  it('delega en ValuationService cuando el usuario existe', async () => {
    userRepository.findOne.mockResolvedValue({
      id: 1,
      email: 'user@test.com',
      accountNumber: '10001',
    });
    valuationService.getPortfolio.mockResolvedValue({
      userId: 1,
      availableCash: 748571,
      positions: [],
      totalAccountValue: 748571,
    });

    const result = await service.getPortfolio(1);

    expect(result.availableCash).toBe(748571);
    expect(valuationService.getPortfolio).toHaveBeenCalledWith(1);
  });

  it('lanza 404 y no consulta ValuationService si el usuario no existe', async () => {
    userRepository.findOne.mockResolvedValue(null);

    await expect(service.getPortfolio(999)).rejects.toThrow(NotFoundException);
    expect(valuationService.getPortfolio).not.toHaveBeenCalled();
  });
});
