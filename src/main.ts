import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { getConfig } from './config/config';

async function bootstrap() {
  // bufferLogs: los logs de arranque de Nest (inicialización de módulos, rutas
  // mapeadas) se guardan en un buffer hasta que `useLogger` toma el control, así
  // también salen formateados por pino en vez de perderse con el logger default.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.useLogger(app.get(Logger));

  // Versionado por URI: todas las rutas quedan bajo /v1/... salvo las que
  // declaren explícitamente VERSION_NEUTRAL (ver HealthController). /docs y /docs-json
  // no pasan por acá: SwaggerModule los monta aparte, no como rutas de un controller.
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Cocos Challenge — Backend')
    .setDescription(
      'Portfolio, búsqueda de instrumentos y envío de órdenes. Ver README/CONTRIBUTING en el repo.',
    )
    .setVersion('1.0')
    .build();
  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument); // UI en /docs, JSON crudo en /docs-json

  await app.listen(getConfig().port);
}
void bootstrap();
