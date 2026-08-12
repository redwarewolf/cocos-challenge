import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../database/entities/user.entity';
import { ValuationService } from '../valuation/valuation.service';
import { Portfolio } from '../valuation/valuation.types';

@Injectable()
export class PortfolioService {
  constructor(
    @InjectRepository(User) private readonly userRepository: Repository<User>,
    private readonly valuationService: ValuationService,
  ) {}

  async getPortfolio(userId: number): Promise<Portfolio> {
    const user = await this.userRepository.findOne({ where: { id: userId } });
    if (!user) {
      throw new NotFoundException(`User ${userId} not found`);
    }
    return this.valuationService.getPortfolio(userId);
  }
}
