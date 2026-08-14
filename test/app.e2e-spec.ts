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
  let dataSource: DataSource;

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

    dataSource = app.get(DataSource);
  });

  afterAll(async () => {
    await app.close();
    await stopTestDatabase();
  });

  /**
   * Cada bloque con estado arma su propio usuario en vez de compartir los del seed, así
   * ningún `describe` depende del orden de ejecución: se puede reordenarlos, insertar uno
   * en el medio o correr uno solo con `.only`.
   *
   * Los usuarios del seed (1 y 2) quedan reservados para el bloque que verifica el estado
   * inicial, que es de solo lectura.
   */
  let usuariosCreados = 0;

  async function crearUsuario(): Promise<number> {
    const etiqueta = `e2e-${++usuariosCreados}`;
    const filas = await dataSource.query<{ id: number }[]>(
      `INSERT INTO users (email, accountNumber) VALUES ($1, $2) RETURNING id`,
      [`${etiqueta}@test.com`, etiqueta],
    );
    return filas[0].id;
  }

  async function fondear(userId: number, amount: number): Promise<void> {
    await request(app.getHttpServer())
      .post('/v1/orders/cash')
      .send({ userId, side: 'CASH_IN', amount });
  }

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

    it('no interpreta los wildcards de LIKE del término de búsqueda', async () => {
      // `_` matchea cualquier carácter en LIKE: sin escapar, GG_L devolvería GGAL.
      const guionBajo = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: 'GG_L' });
      expect(guionBajo.body).toMatchObject({ data: [], total: 0 });

      // `%` matchea cualquier cosa: sin escapar, devolvería el listado completo.
      const porcentaje = await request(app.getHttpServer())
        .get('/v1/instruments/search')
        .query({ q: '%' });
      expect(porcentaje.body).toMatchObject({ data: [], total: 0 });
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
    // El único bloque que usa los usuarios del seed, y a propósito: verifica justamente el
    // estado inicial. Ningún otro test los muta (todos crean el suyo), así que estos
    // asserts exactos valen corra cuando corra este bloque.
    it('usuario 1 arranca con el cash del seed y sin posiciones', async () => {
      const res = await request(app.getHttpServer()).get('/v1/portfolio/1');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 1,
        availableCash: 100000,
        reservedCash: 0,
        buyingPower: 100000,
        positions: [],
        totalAccountValue: 100000,
        hasUnvaluedPositions: false,
      });
    });

    it('usuario 2 arranca en cero (sin CASH_IN en el seed)', async () => {
      const res = await request(app.getHttpServer()).get('/v1/portfolio/2');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        userId: 2,
        availableCash: 0,
        reservedCash: 0,
        buyingPower: 0,
        positions: [],
        totalAccountValue: 0,
        hasUnvaluedPositions: false,
      });
    });

    it('responde 404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer()).get('/v1/portfolio/999');

      expect(res.status).toBe(404);
    });
  });

  describe('Costo de una posición con ventas (costo promedio ponderado)', () => {
    let userId: number;

    beforeAll(async () => {
      userId = await crearUsuario();
      // BUY 10 @ 800 y SELL 5 @ 2000: quedan 5 a un costo promedio de 800. Se insertan
      // directo en la DB porque hace falta vender a un precio distinto del de compra, y
      // una MARKET siempre se llena al último close (900 en el seed).
      await dataSource.query(
        `INSERT INTO orders (instrumentId, userId, size, price, side, status, "type", datetime) VALUES
           (2, $1, 10, 800,  'BUY',  'FILLED', 'MARKET', '2024-01-03 10:00:00'),
           (2, $1, 5,  2000, 'SELL', 'FILLED', 'MARKET', '2024-01-03 11:00:00')`,
        [userId],
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
      // 8000 / 10 = 800 de costo promedio × 5 que quedan = 4000. Calcularlo como
      // Σ BUY − Σ SELL daría 8000 − 10000 = -2000, y con un costo negativo el
      // performancePct cae en el guard `> 0` y se reporta 0% en la posición más
      // rentable de la cuenta.
      expect(position.totalCost).toBe(4000);
      // 5 × 900 (último close del seed) = 4500 ⇒ (4500 - 4000) / 4000 = 12.5%
      expect(position.performancePct).toBe(12.5);
    });
  });

  describe('Unicidad del cierre diario', () => {
    it('la base rechaza dos cierres del mismo instrumento para el mismo día', async () => {
      // GGAL (id 2) ya tiene una fila del 2024-01-02 en el seed. Sin esta constraint, cuál
      // de las dos es "el último precio" queda indefinido: una orden podría ejecutarse
      // contra una y el portfolio valuarse contra la otra.
      await expect(
        dataSource.query(
          `INSERT INTO marketdata (instrumentId, "date", "open", high, low, "close", previousclose)
           VALUES (2, '2024-01-02', 800, 999, 795, 999, 800)`,
        ),
      ).rejects.toThrow();
    });
  });

  describe('Tenencia neta negativa', () => {
    let userId: number;

    beforeAll(async () => {
      userId = await crearUsuario();
      // Reproduce lo que hay en la base de Cocos para el usuario 1 sobre BMA: una compra y
      // una venta mayor, las dos FILLED. Se insertan directo porque la API impide vender de
      // más — el descubierto viene de datos cargados por fuera.
      await dataSource.query(
        `INSERT INTO orders (instrumentId, userId, size, price, side, status, "type", datetime) VALUES
           (2, $1, 20, 1540, 'BUY',  'FILLED', 'MARKET', '2024-01-05 10:00:00'),
           (2, $1, 30, 1530, 'SELL', 'FILLED', 'MARKET', '2024-01-05 11:00:00')`,
        [userId],
      );
    });

    it('la posición no se lista, pero el efectivo de la venta sí está', async () => {
      const res = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );

      expect(res.status).toBe(200);
      expect(res.body.positions).toEqual([]);
      // 30 × 1530 − 20 × 1540 = 15.100. El descubierto no se valúa, pero su mitad
      // favorable ya está contada: es justamente lo que hace que valga la pena avisar.
      expect(res.body.availableCash).toBe(15100);
    });
  });

  describe('Posición sobre un instrumento sin marketdata', () => {
    let userId: number;

    beforeAll(async () => {
      userId = await crearUsuario();
      // BMA (id 3) existe en el seed pero no tiene marketdata. Se inserta directo porque
      // por la API no se llega: una MARKET sobre ese instrumento da 400 (no hay precio)
      // y una LIMIT nunca pasa de NEW.
      await dataSource.query(
        `INSERT INTO orders (instrumentId, userId, size, price, side, status, "type", datetime)
         VALUES (3, $1, 5, 1000, 'BUY', 'FILLED', 'MARKET', '2024-01-04 10:00:00')`,
        [userId],
      );
      await fondear(userId, 10_000);
    });

    it('la posición se lista sin valuar en vez de reportar 0 y -100 %', async () => {
      const res = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );

      expect(res.status).toBe(200);
      const position = res.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 3,
      ) as {
        quantity: number;
        totalCost: number;
        marketValue: number | null;
        performancePct: number | null;
        lastPrice: number | null;
      };

      expect(position.quantity).toBe(5);
      expect(position.lastPrice).toBeNull();
      expect(position.marketValue).toBeNull();
      expect(position.performancePct).toBeNull();
      // El costo no depende del mercado: sale de las órdenes.
      expect(position.totalCost).toBe(5000);
    });

    it('totalAccountValue no la suma, y avisa que quedó incompleto', async () => {
      const res = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );

      // 10.000 de CASH_IN menos los 5.000 que costó la compra.
      expect(res.body.availableCash).toBe(5000);
      // Igual al cash: la única posición no se puede valuar, así que no suma nada.
      expect(res.body.totalAccountValue).toBe(5000);
      expect(res.body.hasUnvaluedPositions).toBe(true);
    });
  });

  describe('Paginación estable del historial con datetime empatado', () => {
    let userId: number;
    const totalOrdenes = 6;

    beforeAll(async () => {
      userId = await crearUsuario();
      // Se insertan directo con el mismo datetime: por la API haría falta que varios
      // requests cayeran en el mismo milisegundo, que pasa en la práctica pero no se
      // puede forzar de forma confiable.
      await dataSource.query(
        `INSERT INTO orders (instrumentId, userId, size, price, side, status, "type", datetime)
         SELECT 2, $1, 1, 900, 'BUY', 'FILLED', 'MARKET', '2024-02-01 12:00:00'
         FROM generate_series(1, $2)`,
        [userId, totalOrdenes],
      );
    });

    it('paginar no repite ni pierde filas cuando el datetime empata', async () => {
      const vistas: number[] = [];

      for (let page = 1; page <= totalOrdenes / 2; page++) {
        const res = await request(app.getHttpServer())
          .get('/v1/orders')
          .query({ userId, page, limit: 2 });

        expect(res.status).toBe(200);
        expect(res.body.total).toBe(totalOrdenes);
        const data = res.body.data as { id: number }[];
        vistas.push(...data.map((o) => o.id));
      }

      // Sin desempate por id, alguna fila podría aparecer en dos páginas y otra en
      // ninguna: el total de ids vistos seguiría siendo 6, pero los únicos, no.
      expect(vistas).toHaveLength(totalOrdenes);
      expect(new Set(vistas).size).toBe(totalOrdenes);
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

  describe('POST /orders — inputs fuera del rango de las columnas', () => {
    // Los tres casos llegaban a Postgres y volvían como 500: el insert ocurre aunque la
    // orden vaya a quedar REJECTED, así que ni siquiera hace falta tener fondos.
    it('400 si size no entra en orders.size (INT)', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 3_000_000_000,
      });

      expect(res.status).toBe(400);
    });

    it('400 si price no entra en orders.price NUMERIC(10,2)', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'LIMIT',
        size: 1,
        price: 1_000_000_000,
      });

      expect(res.status).toBe(400);
    });

    it('400 si el size derivado de amount no entra en INT', async () => {
      // El techo de `amount` no alcanza: lo que desborda es el cociente contra el precio.
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: 1,
        instrumentId: 2,
        side: 'BUY',
        type: 'LIMIT',
        amount: 99_999_999.99,
        price: 0.01,
      });

      expect(res.status).toBe(400);
    });

    it('400 si la Idempotency-Key excede los 255 caracteres de la columna', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Idempotency-Key', 'a'.repeat(256))
        .send({
          userId: 1,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          size: 1,
        });

      expect(res.status).toBe(400);
    });

    it('400 si la Idempotency-Key trae caracteres de control', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', 'retry\t1')
        .send({ userId: 1, side: 'CASH_IN', amount: 100 });

      expect(res.status).toBe(400);
    });

    it('400 si el amount de un movimiento de cash no entra en orders.size', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 1, side: 'CASH_IN', amount: 3_000_000_000 });

      expect(res.status).toBe(400);
    });
  });

  describe('POST /orders y PATCH /orders/:id/cancel — flujo completo', () => {
    // Los `it` de este bloque corren en secuencia a propósito: comprar, vender y cancelar
    // encadenados son el flujo bajo prueba, no un accidente.
    let userId: number;
    let userSinFondos: number;
    let limitOrderId: number;

    beforeAll(async () => {
      userId = await crearUsuario();
      userSinFondos = await crearUsuario();
      await fondear(userId, 100_000);
    });

    it('MARKET BUY se llena inmediatamente al último close', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
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

    it('LIMIT BUY queda NEW con el precio enviado (no el de mercado)', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
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
        userId,
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
        userId,
        instrumentId: 2,
        side: 'SELL',
        type: 'MARKET',
        size: 1000,
      });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED' });
    });

    it('MARKET BUY de un usuario sin fondos queda REJECTED', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId: userSinFondos,
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
        userId,
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

  describe('POST /orders/cash — fondear y retirar (usuario propio, arranca en $0)', () => {
    let userId: number;

    beforeAll(async () => {
      userId = await crearUsuario();
    });

    it('CASH_IN funda al usuario y se refleja en el portfolio', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId, side: 'CASH_IN', amount: 50000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        status: 'FILLED',
        side: 'CASH_IN',
        size: 50000,
      });

      const portfolio = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );
      expect(portfolio.body.availableCash).toBe(50000);
    });

    it('CASH_OUT por más de lo disponible queda REJECTED (pero se persiste)', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId, side: 'CASH_OUT', amount: 200000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'REJECTED' });
    });

    it('CASH_OUT dentro de lo disponible se llena y descuenta del portfolio', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId, side: 'CASH_OUT', amount: 20000 });

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ status: 'FILLED' });

      const portfolio = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );
      expect(portfolio.body.availableCash).toBe(30000);
    });

    it('con el cash recién fondeado, el usuario ya puede comprar', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
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
      const res = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );

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
        .send({ userId, side: 'CASH_IN', amount: -100 });

      expect(res.status).toBe(400);
    });

    it('400 si side no es CASH_IN/CASH_OUT', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId, side: 'BUY', amount: 100 });

      expect(res.status).toBe(400);
    });

    it('404 si el usuario no existe', async () => {
      const res = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId: 999, side: 'CASH_IN', amount: 100 });

      expect(res.status).toBe(404);
    });
  });

  describe('Las órdenes LIMIT en NEW reservan disponible', () => {
    let userId: number;

    beforeAll(async () => {
      userId = await crearUsuario();
      await fondear(userId, 10_000);
    });

    it('una BUY LIMIT baja el poder de compra sin tocar el cash liquidado', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
        instrumentId: 2,
        side: 'BUY',
        type: 'LIMIT',
        size: 8,
        price: 1000,
      });
      expect(res.body.status).toBe('NEW');

      const portfolio = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );
      // El cash sigue liquidado: la orden todavía no se ejecutó.
      expect(portfolio.body.availableCash).toBe(10000);
      expect(portfolio.body.reservedCash).toBe(8000);
      expect(portfolio.body.buyingPower).toBe(2000);
    });

    it('una segunda BUY que excede el poder de compra queda REJECTED', async () => {
      // Contra availableCash (10.000) entraría; contra buyingPower (2.000) no.
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 5,
      });

      expect(res.body.status).toBe('REJECTED');
    });

    it('cancelar la LIMIT libera el poder de compra', async () => {
      const historial = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, status: 'NEW' });
      const pendiente = historial.body.data[0] as { id: number };

      await request(app.getHttpServer()).patch(
        `/v1/orders/${pendiente.id}/cancel`,
      );

      const portfolio = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );
      expect(portfolio.body.reservedCash).toBe(0);
      expect(portfolio.body.buyingPower).toBe(10000);
    });

    it('con el disponible liberado, la misma compra ahora entra', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 5,
      });

      expect(res.body.status).toBe('FILLED');
    });
  });

  describe('Las órdenes SELL en NEW reservan acciones', () => {
    let userId: number;

    beforeAll(async () => {
      userId = await crearUsuario();
      await fondear(userId, 100_000);
      await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 10,
      });
    });

    it('una SELL LIMIT reserva las acciones y se refleja en la posición', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
        instrumentId: 2,
        side: 'SELL',
        type: 'LIMIT',
        size: 8,
        price: 1500,
      });
      expect(res.body.status).toBe('NEW');

      const portfolio = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userId}`,
      );
      const position = portfolio.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      ) as { quantity: number; reservedQuantity: number };

      // La tenencia no cambió: la venta todavía no se ejecutó.
      expect(position.quantity).toBe(10);
      expect(position.reservedQuantity).toBe(8);
    });

    it('una segunda SELL que excede lo vendible queda REJECTED', async () => {
      // Contra la tenencia (10) entraría; contra lo vendible (10 − 8 = 2) no.
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
        instrumentId: 2,
        side: 'SELL',
        type: 'MARKET',
        size: 5,
      });

      expect(res.body.status).toBe('REJECTED');
    });

    it('vender dentro de lo no comprometido sí se ejecuta', async () => {
      const res = await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
        instrumentId: 2,
        side: 'SELL',
        type: 'MARKET',
        size: 2,
      });

      expect(res.body.status).toBe('FILLED');
    });
  });

  describe('Concurrencia real (advisory lock por userId, Postgres real)', () => {
    // Dos usuarios propios: uno para las carreras de compra/venta y otro para la de
    // retiro de cash. Separados porque el advisory lock es *por usuario*: compartirlos
    // haría que una carrera serialice a la otra y el test dejaría de probar lo que dice.
    let userOperaciones: number;
    let userCash: number;

    beforeAll(async () => {
      userOperaciones = await crearUsuario();
      userCash = await crearUsuario();
      await fondear(userOperaciones, 100_000);
      await fondear(userCash, 50_000);
      // Posición inicial, para que la carrera de SELL tenga algo que vender.
      await request(app.getHttpServer()).post('/v1/orders').send({
        userId: userOperaciones,
        instrumentId: 2,
        side: 'BUY',
        type: 'MARKET',
        size: 50,
      });
    });

    it('dos BUY concurrentes que individualmente entran pero juntas no: una FILLED y la otra REJECTED', async () => {
      const before = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userOperaciones}`,
      );
      const availableBefore = before.body.availableCash as number;

      // cada compra usa poco más de la mitad del disponible actual
      const amountEach = Math.floor(availableBefore * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/v1/orders').send({
          userId: userOperaciones,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          amount: amountEach,
        }),
        request(app.getHttpServer()).post('/v1/orders').send({
          userId: userOperaciones,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          amount: amountEach,
        }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userOperaciones}`,
      );
      expect(after.body.availableCash).toBeGreaterThanOrEqual(0);
    });

    it('dos SELL concurrentes que individualmente entran pero juntas no: una FILLED y la otra REJECTED', async () => {
      const before = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userOperaciones}`,
      );
      const position = before.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      );
      const quantityEach = Math.floor(position.quantity * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer()).post('/v1/orders').send({
          userId: userOperaciones,
          instrumentId: 2,
          side: 'SELL',
          type: 'MARKET',
          size: quantityEach,
        }),
        request(app.getHttpServer()).post('/v1/orders').send({
          userId: userOperaciones,
          instrumentId: 2,
          side: 'SELL',
          type: 'MARKET',
          size: quantityEach,
        }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userOperaciones}`,
      );
      const positionAfter = after.body.positions.find(
        (p: { instrumentId: number }) => p.instrumentId === 2,
      );
      expect(positionAfter?.quantity ?? 0).toBeGreaterThanOrEqual(0);
    });

    it('dos CASH_OUT concurrentes que individualmente entran pero juntos no: uno FILLED y el otro REJECTED', async () => {
      const before = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userCash}`,
      );
      const availableBefore = before.body.availableCash as number;

      // cada retiro usa poco más de la mitad del disponible actual
      const amountEach = Math.floor(availableBefore * 0.6);

      const [a, b] = await Promise.all([
        request(app.getHttpServer())
          .post('/v1/orders/cash')
          .send({ userId: userCash, side: 'CASH_OUT', amount: amountEach }),
        request(app.getHttpServer())
          .post('/v1/orders/cash')
          .send({ userId: userCash, side: 'CASH_OUT', amount: amountEach }),
      ]);

      const statuses = [a.body.status, b.body.status].sort();
      expect(statuses).toEqual(['FILLED', 'REJECTED']);

      const after = await request(app.getHttpServer()).get(
        `/v1/portfolio/${userCash}`,
      );
      expect(after.body.availableCash).toBeGreaterThanOrEqual(0);
    });
  });

  describe('GET /orders — historial paginado', () => {
    let userId: number;
    const comprasFilled = 5;
    const totalOrdenes = comprasFilled + 2; // + el CASH_IN inicial + 1 SELL rechazada

    beforeAll(async () => {
      userId = await crearUsuario();
      await fondear(userId, 100_000);

      for (let i = 0; i < comprasFilled; i++) {
        await request(app.getHttpServer()).post('/v1/orders').send({
          userId,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          size: 1,
        });
      }

      // Una sola orden REJECTED, para que el filtro por status tenga un total exacto.
      await request(app.getHttpServer()).post('/v1/orders').send({
        userId,
        instrumentId: 2,
        side: 'SELL',
        type: 'MARKET',
        size: 999999,
      });
    });

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
        .query({ userId, status: 'NOT_A_STATUS' });

      expect(res.status).toBe(400);
    });

    it('devuelve solo órdenes del usuario pedido, ordenadas por datetime descendente', async () => {
      const res = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, limit: 100 });

      expect(res.status).toBe(200);
      expect(res.body.total).toBe(totalOrdenes);
      expect(res.body.data).toHaveLength(totalOrdenes);

      for (const order of res.body.data) {
        expect(order.userId).toBe(userId);
      }
      const datetimes = res.body.data.map((o: { datetime: string }) =>
        new Date(o.datetime).getTime(),
      );
      const sorted = [...datetimes].sort((a: number, b: number) => b - a);
      expect(datetimes).toEqual(sorted);
    });

    it('filtra por status: devuelve exactamente las órdenes en ese estado', async () => {
      const rechazadas = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, status: 'REJECTED', limit: 100 });

      expect(rechazadas.status).toBe(200);
      expect(rechazadas.body.total).toBe(1);
      expect(rechazadas.body.data[0].status).toBe('REJECTED');

      const llenas = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, status: 'FILLED', limit: 100 });

      // las 5 compras + el CASH_IN
      expect(llenas.body.total).toBe(comprasFilled + 1);
    });

    it('pagina sin solapamiento entre páginas y cubre el total', async () => {
      const page1 = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, page: 1, limit: 3 });
      const page2 = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, page: 2, limit: 3 });
      const page3 = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, page: 3, limit: 3 });

      expect(page1.body.total).toBe(totalOrdenes);
      expect(page2.body.total).toBe(totalOrdenes);

      const ids = [...page1.body.data, ...page2.body.data, ...page3.body.data]
        .map((o: { id: number }) => o.id)
        .filter((id): id is number => typeof id === 'number');

      expect(ids).toHaveLength(totalOrdenes);
      expect(new Set(ids).size).toBe(totalOrdenes);
    });
  });

  describe('Idempotency-Key', () => {
    let userId: number;
    let otroUserId: number;

    beforeAll(async () => {
      userId = await crearUsuario();
      otroUserId = await crearUsuario();
      await fondear(userId, 10_000);
    });

    it('reintento secuencial con la misma key en POST /orders/cash devuelve la misma orden, sin duplicarla en la DB', async () => {
      const key = 'e2e-cash-key-1';
      const first = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId, side: 'CASH_IN', amount: 1234 });

      expect(first.status).toBe(201);
      expect(first.body.status).toBe('FILLED');
      expect(first.body.idempotencyKey).toBe(key);

      const second = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId, side: 'CASH_IN', amount: 1234 });

      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);

      const history = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, limit: 100 });
      const matching = history.body.data.filter(
        (o: { id: number }) => o.id === first.body.id,
      );
      expect(matching).toHaveLength(1);
    });

    it('la misma key desde dos usuarios distintos crea dos órdenes, cada una de su dueño', async () => {
      // La key la elige el cliente, así que la colisión entre cuentas no es hipotética.
      // Con una constraint UNIQUE global sobre la key sola, el segundo usuario recibiría
      // la orden del primero: userId, instrumento, size y precio ajenos.
      const key = 'e2e-misma-key-dos-usuarios';

      const first = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId, side: 'CASH_IN', amount: 500 });

      const second = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId: otroUserId, side: 'CASH_IN', amount: 500 });

      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).not.toBe(first.body.id);
      expect(first.body.userId).toBe(userId);
      expect(second.body.userId).toBe(otroUserId);
      // Y cada uno sigue siendo idempotente dentro de su propia cuenta.
      const retry = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .set('Idempotency-Key', key)
        .send({ userId: otroUserId, side: 'CASH_IN', amount: 500 });
      expect(retry.body.id).toBe(second.body.id);
    });

    it('sin Idempotency-Key, cada request crea una orden nueva (aunque el body sea idéntico)', async () => {
      const a = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId, side: 'CASH_IN', amount: 1 });
      const b = await request(app.getHttpServer())
        .post('/v1/orders/cash')
        .send({ userId, side: 'CASH_IN', amount: 1 });

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
          .send({ userId, side: 'CASH_IN', amount: 777 }),
        request(app.getHttpServer())
          .post('/v1/orders/cash')
          .set('Idempotency-Key', key)
          .send({ userId, side: 'CASH_IN', amount: 777 }),
      ]);

      expect(a.status).toBe(201);
      expect(b.status).toBe(201);
      expect(a.body.id).toBe(b.body.id);

      const history = await request(app.getHttpServer())
        .get('/v1/orders')
        .query({ userId, limit: 100 });
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
          userId,
          instrumentId: 2,
          side: 'BUY',
          type: 'MARKET',
          size: 1,
        });

      const second = await request(app.getHttpServer())
        .post('/v1/orders')
        .set('Idempotency-Key', key)
        .send({
          userId,
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
