import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import {
  HealthCheck,
  HealthCheckResult,
  HealthCheckService,
  TypeOrmHealthIndicator,
} from '@nestjs/terminus';

@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly db: TypeOrmHealthIndicator,
  ) {}

  /**
   * No es solo liveness ("¿el proceso responde?") sino readiness: chequea que la
   * conexión a la DB (Neon) esté realmente disponible, que es la única dependencia
   * externa de esta API y la causa más probable de que el servicio no pueda operar
   * aunque el proceso de Node siga arriba.
   */
  @Get()
  @HealthCheck()
  check(): Promise<HealthCheckResult> {
    return this.health.check([() => this.db.pingCheck('database')]);
  }
}
