import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types';
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
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    await stopTestDatabase();
  });

  describe('GET /instruments/search', () => {
    it('busca por ticker', async () => {
      const res = await request(app.getHttpServer())
        .get('/instruments/search')
        .query({ q: 'ggal' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([
        expect.objectContaining({
          ticker: 'GGAL',
          name: 'Grupo Financiero Galicia',
        }),
      ]);
    });

    it('busca por nombre', async () => {
      const res = await request(app.getHttpServer())
        .get('/instruments/search')
        .query({ q: 'banco' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([expect.objectContaining({ ticker: 'BMA' })]);
    });

    it('excluye el instrumento MONEDA aunque matchee', async () => {
      const res = await request(app.getHttpServer())
        .get('/instruments/search')
        .query({ q: 'ars' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('devuelve [] si no hay resultados', async () => {
      const res = await request(app.getHttpServer())
        .get('/instruments/search')
        .query({ q: 'zzzz' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual([]);
    });

    it('responde 400 si falta el query param "q"', async () => {
      const res = await request(app.getHttpServer()).get('/instruments/search');

      expect(res.status).toBe(400);
    });
  });

  describe('GET /portfolio/:userId (estado inicial del seed)', () => {
    it('usuario 1 arranca con el cash del seed y sin posiciones', async () => {
      const res = await request(app.getHttpServer()).get('/portfolio/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 1,
        availableCash: 100000,
        positions: [],
        totalAccountValue: 100000,
      });
    });

    it('usuario 2 arranca en cero (sin CASH_IN en el seed)', async () => {
      const res = await request(app.getHttpServer()).get('/portfolio/2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 2,
        availableCash: 0,
        positions: [],
        totalAccountValue: 0,
      });
    });

    it('responde 404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer()).get('/portfolio/999');

      expect(res.status).toBe(404);
    });
  });

  describe('POST /orders — validaciones de input', () => {
    it('400 si una orden LIMIT no manda price', async () => {
      const res = await request(app.getHttpServer()).post('/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
      });

      expect(res.status).toBe(400);
    });

    it('400 si manda "size" y "amount" a la vez', async () => {
      const res = await request(app.getHttpServer()).post('/orders').send({
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
      const res = await request(app.getHttpServer()).post('/orders').send({
        userId: 1,
        instrumentId: 1,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });

      expect(res.status).toBe(400);
    });

    it('404 si el instrumento no existe', async () => {
      const res = await request(app.getHttpServer()).post('/orders').send({
        userId: 1,
        instrumentId: 999,
        side: 'BUY',
        type: 'MARKET',
        size: 1,
      });

      expect(res.status).toBe(404);
    });

    it('404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer()).post('/orders').send({
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
      const res = await request(app.getHttpServer()).post('/orders').send({
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
      const res = await request(app.getHttpServer()).post('/orders').send({
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
      const res = await request(app.getHttpServer()).post('/orders').send({
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
      const res = await request(app.getHttpServer()).post('/orders').send({
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
      const res = await request(app.getHttpServer()).post('/orders').send({
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
      const res = await request(app.getHttpServer()).post('/orders').send({
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
        `/orders/${limitOrderId}/cancel`,
      );

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ id: limitOrderId, status: 'CANCELLED' });
    });

    it('no permite cancelar una orden que no está NEW', async () => {
      const res = await request(app.getHttpServer()).patch(
        `/orders/${limitOrderId}/cancel`,
      );

      expect(res.status).toBe(400);
    });

    it('404 al cancelar una orden inexistente', async () => {
      const res = await request(app.getHttpServer()).patch(
        '/orders/999999/cancel',
      );

      expect(res.status).toBe(404);
    });
  });

  describe('POST /orders/cash — fondear y retirar (usuario 2, arranca en $0)', () => {
    it('CASH_IN funda al usuario y se refleja en el portfolio', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders/cash')
        .send({ userId: 2, side: 'CASH_IN', amount: 50000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'FILLED',
        side: 'CASH_IN',
        size: 50000,
      });

      const portfolio = await request(app.getHttpServer()).get('/portfolio/2');
      expect(portfolio.body.availableCash).toBe(50000);
    });

    it('CASH_OUT por más de lo disponible queda REJECTED (pero se persiste)', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders/cash')
        .send({ userId: 2, side: 'CASH_OUT', amount: 200000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED' });
    });

    it('CASH_OUT dentro de lo disponible se llena y descuenta del portfolio', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders/cash')
        .send({ userId: 2, side: 'CASH_OUT', amount: 20000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'FILLED' });

      const portfolio = await request(app.getHttpServer()).get('/portfolio/2');
      expect(portfolio.body.availableCash).toBe(30000);
    });

    it('con el cash recién fondeado, el usuario ya puede comprar', async () => {
      const res = await request(app.getHttpServer()).post('/orders').send({
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

    it('400 si el amount no es positivo', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders/cash')
        .send({ userId: 2, side: 'CASH_IN', amount: -100 });

      expect(res.status).toBe(400);
    });

    it('400 si side no es CASH_IN/CASH_OUT', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders/cash')
        .send({ userId: 2, side: 'BUY', amount: 100 });

      expect(res.status).toBe(400);
    });

    it('404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer())
        .post('/orders/cash')
        .send({ userId: 999, side: 'CASH_IN', amount: 100 });

      expect(res.status).toBe(404);
    });
  });

  describe('Concurrencia real (advisory lock por userId, Postgres real)', () => {
    it('dos BUY concurrentes que individualmente entran pero juntas no: una FILLED y la otra REJECTED', async () => {
      const before = await request(app.getHttpServer()).get('/portfolio/1');
      const availableBefore = before.body.availableCash as number;

      // cada compra usa poco más de la mitad del disponible actual
      const amountEach = Math.floor(availableBefore * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/orders').send({
          userId: 1,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          amount: amountEach,
        }),
        request(app.getHttpServer()).post('/orders').send({
          userId: 1,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          amount: amountEach,
        }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get('/portfolio/1');
      expect(after.body.availableCash).toBeGreaterThanOrEqual(0);
    });

    it('dos SELL concurrentes que individualmente entran pero juntas no: una FILLED y la otra REJECTED', async () => {
      const before = await request(app.getHttpServer()).get('/portfolio/1');
      const position = before.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      );
      const quantityEach = Math.floor(position.quantity * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/orders').send({
          userId: 1,
          instrumentId: 2,
          side: 'SELL',
          type: 'MARKET',
          size: quantityEach,
        }),
        request(app.getHttpServer()).post('/orders').send({
          userId: 1,
          instrumentId: 2,
          side: 'SELL',
          type: 'MARKET',
          size: quantityEach,
        }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get('/portfolio/1');
      const positionAfter = after.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      );
      expect(positionAfter?.quantity ?? 0).toBeGreaterThanOrEqual(0);
    });

    it('dos CASH_OUT concurrentes que individualmente entran pero juntos no: uno FILLED y el otro REJECTED', async () => {
      const before = await request(app.getHttpServer()).get('/portfolio/2');
      const availableBefore = before.body.availableCash as number;

      // cada retiro usa poco más de la mitad del disponible actual
      const amountEach = Math.floor(availableBefore * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/orders/cash')
          .send({ userId: 2, side: 'CASH_OUT', amount: amountEach }),
        request(app.getHttpServer())
          .post('/orders/cash')
          .send({ userId: 2, side: 'CASH_OUT', amount: amountEach }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get('/portfolio/2');
      expect(after.body.availableCash).toBeGreaterThanOrEqual(0);
    });
  });
});
