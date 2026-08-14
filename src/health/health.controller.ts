import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

const DB_PING_TIMEOUT_MS = 3000;

@ApiTags('health')
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  /**
   * Readiness: pinguea la conexión real a la base. El timeout contempla la primera conexión
   * —cold start del Postgres serverless más el handshake TLS—, que tarda bastante más que las
   * siguientes; con el default de 1000 ms el endpoint reporta la base caída mientras el resto
   * de la API responde normalmente.
   */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([
      () => this.db.pingCheck('database', { timeout: DB_PING_TIMEOUT_MS }),
    ]);
  }
}
