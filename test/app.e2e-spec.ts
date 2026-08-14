import {
  INestApplication,
  ValidationPipe,
  VersioningType,
} from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import request from 'supertest';
import type { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { startTestDatabase, stopTestDatabase } from './setup/test-database';

jest.setTimeout(120_000); // primer arranque de Testcontainers puede tardar en bajar la imagen

describe('API e2e (Postgres real vía Testcontainers)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    await startTestDatabase();

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    // mismo setup que main.ts — createNestApplication() no corre bootstrap(), así que
    // hay que repetir acá el versionado, los pipes y Swagger (para poder testear /docs-json).
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: '1' });
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    const swaggerDocument = SwaggerModule.createDocument(
      app,
      new DocumentBuilder().build(),
    );
    SwaggerModule.setup('docs', app, swaggerDocument);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await stopTestDatabase();
  });

  describe('GET /health', () => {
    it('devuelve 200 y status ok con la DB real de Testcontainers arriba', async () => {
      const res = await request(app.getHttpServer()).get('/health');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        status: 'ok',
        info: { database: { status: 'up' } },
      });
    });
  });

  describe('GET /docs-json', () => {
    it('expone el documento OpenAPI con los paths esperados', async () => {
      const res = await request(app.getHttpServer()).get('/docs-json');

      expect(res.status).toBe(200);
      expect(res.body.paths).toHaveProperty('/v1/orders');
      expect(res.body.paths).toHaveProperty('/v1/orders/cash');
      expect(res.body.paths).toHaveProperty('/v1/orders/{id}/cancel');
      expect(res.body.paths).toHaveProperty('/v1/portfolio/{userId}');
      expect(res.body.paths).toHaveProperty('/v1/instruments/search');
      expect(res.body.paths).toHaveProperty('/health');
    });
  });

  describe('GET /instruments/search (paginado)', () => {
    it('busca por ticker y devuelve el envelope paginado', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'ggal' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ total: 1, page: 1, limit: 20 });
      expect(res.body.data).toEqual([
        expect.objectContaining({
          ticker: 'GGAL',
          name: 'Grupo Financiero Galicia',
        }),
      ]);
    });

    it('busca por nombre', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'banco', limit: 100 });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(4); // BMA, BBAR, BHIP, BPAT
      expect(res.body.data).toHaveLength(4);
    });

    it('pagina: page=1&limit=2 devuelve solo 2, page=2&limit=2 devuelve el resto sin repetir', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'banco', page: 1, limit: 2 });
      const page2 = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'banco', page: 2, limit: 2 });

      expect(page1.body).toMatchObject({ total: 4, page: 1, limit: 2 });
      expect(page2.body).toMatchObject({ total: 4, page: 2, limit: 2 });
      expect(page1.body.data).toHaveLength(2);
      expect(page2.body.data).toHaveLength(2);

      const tickersPage1 = page1.body.data.map(
        (i: { ticker: string }) => i.ticker,
      );
      const tickersPage2 = page2.body.data.map(
        (i: { ticker: string }) => i.ticker,
      );
      expect(new Set([...tickersPage1, ...tickersPage2]).size).toBe(4); // sin solapamiento
    });

    it('excluye el instrumento MONEDA aunque matchee', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'ars' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ data: [], total: 0 });
    });

    it('devuelve una página vacía si no hay resultados', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'zzzz' });

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ data: [], total: 0 });
    });

    it('responde 400 si falta el query param "q"', async () => {
      const res = await request(app.getHttpServer()).get(
        '/v1/instruments/search',
      );

      expect(res.status).toBe(400);
    });

    it('responde 400 si limit supera el máximo permitido (100)', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'ggal', limit: 101 });

      expect(res.status).toBe(400);
    });

    it('responde 400 si page no es un entero positivo', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'ggal', page: 0 });

      expect(res.status).toBe(400);
    });
  });

  describe('GET /portfolio/:userId (estado inicial del seed)', () => {
    it('usuario 1 arranca con el cash del seed y sin posiciones', async () => {
      const res = await request(app.getHttpServer()).get('/v1/portfolio/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 1,
        availableCash: 100000,
        positions: [],
        totalAccountValue: 100000,
      });
    });

    it('usuario 2 arranca en cero (sin CASH_IN en el seed)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/portfolio/2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 2,
        availableCash: 0,
        positions: [],
        totalAccountValue: 0,
      });
    });

    it('responde 404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer()).get('/v1/portfolio/999');

      expect(res.status).toBe(404);
    });
  });

  describe('Costo de una posición con ventas (costo promedio ponderado)', () => {
    // Bloque autocontenido: arma su propio usuario e historial y no depende de lo que
    // hayan dejado los tests anteriores. Las órdenes se insertan directo en la DB
    // porque hace falta una venta a un precio distinto del de compra, y una MARKET
    // siempre se llena al último close (900 en el seed).
    const userId = 3;

    beforeAll(async () => {
      const dataSource = app.get(DataSource);
      await dataSource.query(
        `INSERT INTO users (id, email, accountNumber) VALUES (3, 'wac@test.com', '90003')`,
      );
      // BUY 10 @ 800 y SELL 5 @ 2000: quedan 5 a un costo promedio de 800.
      await dataSource.query(
        `INSERT INTO orders (instrumentId, userId, size, price, side, status, "type", datetime) VALUES
           (2, 3, 10, 800,  'BUY',  'FILLED', 'MARKET', '2024-01-03 10:00:00'),
           (2, 3, 5,  2000, 'SELL', 'FILLED', 'MARKET', '2024-01-03 11:00:00')`,
      );
    });

    it('el costo es el promedio de compra × la tenencia, y nunca queda negativo', async () => {
      const res = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );

      const position = res.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      ) as { quantity: number; totalCost: number; performancePct: number };

      expect(position.quantity).toBe(5);
      // 8000 / 10 = 800 de costo promedio × 5 que quedan = 4000. La fórmula anterior
      // (Σ BUY − Σ SELL) daba 8000 − 10000 = -2000, y con ese costo negativo el
      // performancePct caía en el guard `> 0` y se reportaba 0% en la posición más
      // rentable de la cuenta.
      expect(position.totalCost).toBe(4000);
      // 5 × 900 (último close del seed) = 4500 ⇒ (4500 - 4000) / 4000 = 12.5%
      expect(position.performancePct).toBe(12.5);
    });
  });

  describe('POST /orders — validaciones de input', () => {
    it('400 si una orden LIMIT no manda price', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
      });

      expect(res.status).toBe(400);
    });

    it('400 si manda "size" y "amount" a la vez', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
        amount: 100,
      });

      expect(res.status).toBe(400);
    });

    it('400 al operar sobre el instrumento MONEDA', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 1,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });

      expect(res.status).toBe(400);
    });

    it('404 si el instrumento no existe', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 999,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });

      expect(res.status).toBe(404);
    });

    it('404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 999,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });

      expect(res.status).toBe(404);
    });
  });

  describe('POST /orders y PATCH /orders/:id/cancel — flujo completo', () => {
    it('MARKET BUY se llena inmediatamente al último close', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 10,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'FILLED',
        size: 10,
        price: '900.00',
      });
    });

    let limitOrderId: number;

    it('LIMIT BUY queda NEW con el precio enviado (no el de mercado)', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'LIMIT',
        size: 5,
        price: 500,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'NEW', price: '500.00' });
      limitOrderId = res.body.id;
    });

    it('MARKET SELL de una cantidad que sí tiene se llena', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'SELL',
        type: 'MARKET',
        size: 3,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'FILLED', size: 3 });
    });

    it('MARKET SELL de más de lo que tiene queda REJECTED (pero se persiste)', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'SELL',
        type: 'MARKET',
        size: 1000,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED' });
    });

    it('MARKET BUY sin fondos (usuario 2) queda REJECTED', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 2,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED' });
    });

    it('BUY MARKET por "amount" calcula el size máximo entero', async () => {
      // 900 de close, 2000 de amount -> floor(2000/900) = 2 acciones
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        amount: 2000,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'FILLED',
        size: 2,
        price: '900.00',
      });
    });

    it('cancela la orden LIMIT que quedó NEW', async () => {
      const res = await request(app.getHttpServer()).patch(
        `/v1/orders/${limitOrderId}/cancel`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: limitOrderId, status: 'CANCELLED' });
    });

    it('no permite cancelar una orden que no está NEW', async () => {
      const res = await request(app.getHttpServer()).patch(
        `/v1/orders/${limitOrderId}/cancel`,
      );

      expect(res.status).toBe(400);
    });

    it('404 al cancelar una orden inexistente', async () => {
      const res = await request(app.getHttpServer()).patch(
        '/v1/orders/999999/cancel',
      );

      expect(res.status).toBe(404);
    });
  });

  describe('POST /orders/cash — fondear y retirar (usuario 2, arranca en $0)', () => {
    it('CASH_IN funda al usuario y se refleja en el portfolio', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 2, side: 'CASH_IN', amount: 50000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'FILLED',
        side: 'CASH_IN',
        size: 50000,
      });

      const portfolio = await request(app.getHttpServer()).get(
        '/v1/portfolio/2',
      );
      expect(portfolio.body.availableCash).toBe(50000);
    });

    it('CASH_OUT por más de lo disponible queda REJECTED (pero se persiste)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 2, side: 'CASH_OUT', amount: 200000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED' });
    });

    it('CASH_OUT dentro de lo disponible se llena y descuenta del portfolio', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 2, side: 'CASH_OUT', amount: 20000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'FILLED' });

      const portfolio = await request(app.getHttpServer()).get(
        '/v1/portfolio/2',
      );
      expect(portfolio.body.availableCash).toBe(30000);
    });

    it('con el cash recién fondeado, el usuario ya puede comprar', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 2,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 20,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'FILLED',
        size: 20,
        price: '900.00',
      });
    });

    it('la posición reporta el retorno diario contra previousClose', async () => {
      const res = await request(app.getHttpServer()).get('/v1/portfolio/2');

      const position = res.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      ) as {
        dailyReturnPct: number;
        performancePct: number;
        lastPrice: number;
        previousClose: number;
      };

      // El seed deja GGAL con close 900 y previousClose 800: (900 - 800) / 800 * 100.
      expect(position.lastPrice).toBe(900);
      expect(position.previousClose).toBe(800);
      expect(position.dailyReturnPct).toBe(12.5);
      // Se compró justo al último close, así que todavía no hay rendimiento contra el
      // costo — es lo que distingue las dos métricas.
      expect(position.performancePct).toBe(0);
    });

    it('400 si el amount no es positivo', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 2, side: 'CASH_IN', amount: -100 });

      expect(res.status).toBe(400);
    });

    it('400 si side no es CASH_IN/CASH_OUT', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 2, side: 'BUY', amount: 100 });

      expect(res.status).toBe(400);
    });

    it('404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 999, side: 'CASH_IN', amount: 100 });

      expect(res.status).toBe(404);
    });
  });

  describe('Concurrencia real (advisory lock por userId, Postgres real)', () => {
    it('dos BUY concurrentes que individualmente entran pero juntas no: una FILLED y la otra REJECTED', async () => {
      const before = await request(app.getHttpServer()).get('/v1/portfolio/1');
      const availableBefore = before.body.availableCash as number;

      // cada compra usa poco más de la mitad del disponible actual
      const amountEach = Math.floor(availableBefore * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/v1/orders').send({
          userId: 1,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          amount: amountEach,
        }),
        request(app.getHttpServer()).post('/v1/orders').send({
          userId: 1,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          amount: amountEach,
        }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get('/v1/portfolio/1');
      expect(after.body.availableCash).toBeGreaterThanOrEqual(0);
    });

    it('dos SELL concurrentes que individualmente entran pero juntas no: una FILLED y la otra REJECTED', async () => {
      const before = await request(app.getHttpServer()).get('/v1/portfolio/1');
      const position = before.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      );
      const quantityEach = Math.floor(position.quantity * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/v1/orders').send({
          userId: 1,
          instrumentId: 2,
          side: 'SELL',
          type: 'MARKET',
          size: quantityEach,
        }),
        request(app.getHttpServer()).post('/v1/orders').send({
          userId: 1,
          instrumentId: 2,
          side: 'SELL',
          type: 'MARKET',
          size: quantityEach,
        }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get('/v1/portfolio/1');
      const positionAfter = after.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      );
      expect(positionAfter?.quantity ?? 0).toBeGreaterThanOrEqual(0);
    });

    it('dos CASH_OUT concurrentes que individualmente entran pero juntos no: uno FILLED y el otro REJECTED', async () => {
      const before = await request(app.getHttpServer()).get('/v1/portfolio/2');
      const availableBefore = before.body.availableCash as number;

      // cada retiro usa poco más de la mitad del disponible actual
      const amountEach = Math.floor(availableBefore * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/v1/orders/cash')
          .send({ userId: 2, side: 'CASH_OUT', amount: amountEach }),
        request(app.getHttpServer())
          .post('/v1/orders/cash')
          .send({ userId: 2, side: 'CASH_OUT', amount: amountEach }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get('/v1/portfolio/2');
      expect(after.body.availableCash).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /orders — historial paginado (corre al final, con todo lo generado por los tests anteriores)', () => {
    it('404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId: 999 });

      expect(res.status).toBe(404);
    });

    it('400 si falta userId', async () => {
      const res = await request(app.getHttpServer()).get('/v1/orders');

      expect(res.status).toBe(400);
    });

    it('400 si status no es un valor válido', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId: 1, status: 'NOT_A_STATUS' });

      expect(res.status).toBe(400);
    });

    it('devuelve solo órdenes del usuario pedido, ordenadas por datetime descendente', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId: 1, limit: 100 });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      expect(res.body.total).toBe(res.body.data.length); // limit 100 alcanza para traer todo

      for (const order of res.body.data) {
        expect(order.userId).toBe(1);
      }
      const datetimes = res.body.data.map((o: { datetime: string }) =>
        new Date(o.datetime).getTime(),
      );
      const sorted = [...datetimes].sort((a: number, b: number) => b - a);
      expect(datetimes).toEqual(sorted);
    });

    it('filtra por status: todo lo que devuelve tiene ese status exacto', async () => {
      // orden fresca y determinística en REJECTED, para no depender de que los tests
      // anteriores hayan dejado alguna orden en ese estado.
      await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'SELL',
        type: 'MARKET',
        size: 999999,
      });

      const res = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId: 1, status: 'REJECTED', limit: 100 });

      expect(res.status).toBe(200);
      expect(res.body.data.length).toBeGreaterThan(0);
      for (const order of res.body.data) {
        expect(order.status).toBe('REJECTED');
      }
    });

    it('pagina sin solapamiento entre páginas', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId: 1, page: 1, limit: 3 });
      const page2 = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId: 1, page: 2, limit: 3 });

      expect(page1.body.total).toBe(page2.body.total);
      const idsPage1 = page1.body.data.map((o: { id: number }) => o.id);
      const idsPage2 = page2.body.data.map((o: { id: number }) => o.id);
      expect(
        idsPage1.filter((id: number) => idsPage2.includes(id)),
      ).toHaveLength(0);
    });
  });

  describe('Idempotency-Key (issue #8, corre al final para no interferir con los totales de arriba)', () => {
    it('reintento secuencial con la misma key en POST /orders/cash devuelve la misma orden, sin duplicarla en la DB', async () => {
      const key = 'e2e-cash-key-1';
      const first = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId: 2, side: 'CASH_IN', amount: 1234 });

      expect(first.status).toBe(201);
      expect(first.body.status).toBe('FILLED');
      expect(first.body.idempotencyKey).toBe(key);

      const second = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId: 2, side: 'CASH_IN', amount: 1234 });

      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const history = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId: 2, limit: 100 });
      const matching = history.body.data.filter(
        (o: { id: number }) => o.id === first.body.id,
      );
      expect(matching).toHaveLength(1);
    });

    it('la misma key desde dos usuarios distintos crea dos órdenes, cada una de su dueño', async () => {
      // La key la elige el cliente, así que la colisión entre cuentas no es hipotética.
      // Con la constraint UNIQUE global anterior, el segundo usuario recibía la orden del
      // primero: userId, instrumento, size y precio ajenos.
      const key = 'e2e-misma-key-dos-usuarios';

      const first = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId: 1, side: 'CASH_IN', amount: 500 });

      const second = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId: 2, side: 'CASH_IN', amount: 500 });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect(first.body.userId).toBe(1);
      expect(second.body.userId).toBe(2);
      // Y cada uno sigue siendo idempotente dentro de su propia cuenta.
      const retry = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId: 2, side: 'CASH_IN', amount: 500 });
      expect(retry.body.id).toBe(second.body.id);
    });

    it('sin Idempotency-Key, cada request crea una orden nueva (aunque el body sea idéntico)', async () => {
      const a = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 2, side: 'CASH_IN', amount: 1 });
      const b = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 2, side: 'CASH_IN', amount: 1 });

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).not.toBe(b.body.id);
    });

    it('dos requests concurrentes con la misma key: los dos responden 201 con la misma orden, sin duplicar en la DB', async () => {
      const key = 'e2e-concurrent-key';

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/v1/orders/cash')
          .set('Idempotency-Key', key)
          .send({ userId: 2, side: 'CASH_IN', amount: 777 }),
        request(app.getHttpServer())
          .post('/v1/orders/cash')
          .set('Idempotency-Key', key)
          .send({ userId: 2, side: 'CASH_IN', amount: 777 }),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).toBe(b.body.id);

      const history = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId: 2, limit: 100 });
      const matching = history.body.data.filter(
        (o: { id: number }) => o.id === a.body.id,
      );
      expect(matching).toHaveLength(1);
    });

    it('POST /orders (compra/venta) también respeta la Idempotency-Key', async () => {
      const key = 'e2e-orders-key-1';

      const first = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Idempotency-Key', key)
        .send({
          userId: 1,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          size: 1,
        });

      const second = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Idempotency-Key', key)
        .send({
          userId: 1,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          size: 1,
        });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
    });
  });
});
