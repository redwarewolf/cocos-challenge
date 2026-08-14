import { Test, TestingModule } from '@nestjs/testing';
import { HealthCheckService, TypeOrmHealthIndicator } from '@nestjs/terminus';
import { HealthController } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;

  const health = { check: jest.fn() };
  const db = { pingCheck: jest.fn() };

  beforeEach(async () => {
    jest.clearAllMocks();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [
        { provide: HealthCheckService, useValue: health },
        { provide: TypeOrmHealthIndicator, useValue: db },
      ],
    }).compile();

    controller = module.get(HealthController);
  });

  it('delega en HealthCheckService.check() pingueando la conexión a la DB', async () => {
    const result = {
      status: 'ok',
      info: { database: { status: 'up' } },
      error: {},
      details: {},
    };
    db.pingCheck.mockResolvedValue({ database: { status: 'up' } });
    health.check.mockImplementation(
      async (indicators: Array<() => Promise<unknown>>) => {
        // ejecuta los indicadores como lo haría el HealthCheckService real, para
        // verificar que el check efectivamente pinguea "database" y no otra cosa.
        await Promise.all(indicators.map((fn) => fn()));
        return result;
      },
    );

    const response = await controller.check();

    expect(response).toBe(result);
    // Con el timeout explícito: el default de Terminus (1000 ms) no alcanza para la primera
    // conexión contra un Postgres serverless.
    expect(db.pingCheck).toHaveBeenCalledWith('database', { timeout: 3000 });
  });
});
