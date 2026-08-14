# Cocos Challenge — Backend

[![CI](https://github.com/redwarewolf/cocos-challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/redwarewolf/cocos-challenge/actions/workflows/ci.yml)

API en NestJS + TypeScript + TypeORM (PostgreSQL) que resuelve el
[backend challenge de Cocos Capital](https://github.com/cocos-capital/cocos-challenge/blob/main/backend-challenge.md):
consulta de portfolio, búsqueda de instrumentos y envío de órdenes al mercado.

El *por qué* de cada decisión no trivial está en **[DECISIONS.md](DECISIONS.md)**.

## Requisitos

- Acceso a la base PostgreSQL provista por Cocos (Neon) — la única dependencia externa real,
  con o sin Docker.
- Opción A: Node.js 20+ (probado con Node 22).
- Opción B: Docker (para no necesitar Node instalado localmente). También hace falta Docker
  corriendo para `npm run test:e2e` en la opción A — levanta un Postgres descartable vía
  Testcontainers; no hace falta para `npm run start:dev` ni para `npm test`.

## Setup

```bash
npm install
cp .env.example .env   # completar DATABASE_URL con la connection string real
npm run start:dev
```

Alternativa con Docker, sin necesitar Node instalado (la DB sigue siendo la Neon remota; el
contenedor solo corre la API):

```bash
cp .env.example .env   # completar DATABASE_URL con la connection string real
docker compose up --build
```

La API queda escuchando en `http://localhost:3000` (configurable con `PORT`, en ambas opciones).
Documentación interactiva (Swagger UI) en `http://localhost:3000/docs`, JSON crudo (OpenAPI) en
`/docs-json`. Solo se montan fuera de producción: el schema describe toda la superficie de la API.

El esquema se versiona con migraciones (`npm run migration:run`). La base provista ya las tiene
aplicadas; el comando es idempotente y solo corre las pendientes.

## Endpoints

Los tres primeros son los que pide el challenge; el resto son bonus.

| Método | Ruta | Qué hace |
| --- | --- | --- |
| `GET` | `/v1/portfolio/:userId` | Valor de cuenta, pesos disponibles y posiciones |
| `GET` | `/v1/instruments/search?q=` | Busca instrumentos por ticker o nombre |
| `POST` | `/v1/orders` | Envía una orden `BUY`/`SELL`, `MARKET`/`LIMIT` |
| `POST` | `/v1/orders/cash` | Deposita o retira pesos (bonus) |
| `GET` | `/v1/orders?userId=` | Historial de órdenes paginado (bonus) |
| `PATCH` | `/v1/orders/:id/cancel` | Cancela una orden en estado `NEW` (bonus) |
| `GET` | `/health` | Readiness: pinguea la conexión real a la DB |

### `GET /v1/portfolio/:userId`

```json
{
  "userId": 1,
  "availableCash": 753000,
  "reservedCash": 0,
  "buyingPower": 753000,
  "positions": [
    {
      "instrumentId": 47,
      "ticker": "PAMP",
      "name": "Pampa Holding S.A.",
      "quantity": 40,
      "reservedQuantity": 0,
      "lastPrice": 925.85,
      "previousClose": 900,
      "marketValue": 37034,
      "totalCost": 37100,
      "performancePct": -0.18,
      "dailyReturnPct": 2.87
    }
  ],
  "totalAccountValue": 904784,
  "hasUnvaluedPositions": false
}
```

Una orden en estado `NEW` todavía no movió plata ni acciones, pero ya las compromete. Por eso el
disponible viene en tres números: `availableCash` es lo liquidado, `reservedCash` lo comprometido en
órdenes `BUY` pendientes, y `buyingPower` la diferencia — **es contra este último que se valida una
orden nueva**. Por posición vale lo mismo con `quantity` y `reservedQuantity`. Cancelar una orden
`NEW` libera lo comprometido de inmediato.

Cada posición trae dos rendimientos, que responden preguntas distintas:

| Campo | Fórmula | Responde |
| --- | --- | --- |
| `performancePct` | `(marketValue − totalCost) / totalCost × 100` | ¿cómo me fue desde que compré? |
| `dailyReturnPct` | `(lastPrice − previousClose) / previousClose × 100` | ¿cómo me fue hoy? |

`totalCost` usa costo promedio ponderado; el detalle y el porqué de ambas métricas, en
[DECISIONS.md](DECISIONS.md#4-cómo-se-calcula-el-portfolio).

**Cuando falta el dato de mercado**, la respuesta lo dice en vez de inventar un número:
`dailyReturnPct` es `null` si al instrumento le falta el cierre actual o el anterior, y
`lastPrice`, `marketValue` y `performancePct` son `null` si no tiene cotización — un `marketValue`
de `0` daría `-100%` de rendimiento sobre una posición que puede valer cualquier cosa. Esas
posiciones se listan igual (con su `quantity` y su `totalCost`, que no dependen del mercado) pero no
suman a `totalAccountValue`, y `hasUnvaluedPositions` avisa que el total quedó incompleto.

### `GET /v1/instruments/search?q=<texto>&page=&limit=`

Busca por ticker y/o nombre (case-insensitive, substring). Excluye el instrumento `MONEDA` (ARS).
Paginado: `page` (default 1) y `limit` (default 20, máximo 100).

```json
{
  "data": [
    { "id": 34, "ticker": "GGAL", "name": "Grupo Financiero Galicia", "type": "ACCIONES" }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

### `POST /v1/orders`

```json
{
  "userId": 1,
  "instrumentId": 34,
  "side": "BUY",
  "type": "MARKET",
  "size": 10
}
```

También acepta `"amount": 5000` en pesos en lugar de `size` (se calcula la cantidad máxima de
acciones enteras que ese monto permite comprar al precio resuelto). Para `LIMIT` es obligatorio
enviar `"price"`; para `MARKET` se ignora y se usa el último `close`.

Si no alcanza el disponible, la orden se persiste igual con `status: REJECTED` y responde `201`.
Un request mal formado responde `400`/`404` y no persiste nada — incluidos los valores que exceden
lo que la columna puede guardar (`size` fuera de `INT`, `price` fuera de `NUMERIC(10,2)`), que se
rechazan antes de llegar a la base en vez de volver como un `500`.

### `POST /v1/orders/cash`

Deposita (`CASH_IN`) o retira (`CASH_OUT`) pesos — útil para fondear usuarios de prueba sin tocar la
base directamente (en el seed original solo el usuario 1 tiene cash).

```json
{ "userId": 2, "side": "CASH_IN", "amount": 50000 }
```

`CASH_IN` siempre se llena; `CASH_OUT` queda `REJECTED` si no hay disponible suficiente.

### `GET /v1/orders?userId=&status=&page=&limit=`

Historial de órdenes y movimientos, más recientes primero. `userId` obligatorio, `status` opcional
(`NEW|FILLED|REJECTED|CANCELLED`), mismo envelope paginado que la búsqueda de instrumentos.

### `PATCH /v1/orders/:id/cancel`

Cancela una orden en estado `NEW`. Cualquier otro estado responde `400`.

### Header `Idempotency-Key`

`POST /v1/orders` y `POST /v1/orders/cash` aceptan un header opcional `Idempotency-Key`. Si un
cliente reintenta el mismo request mandando la misma key —por ejemplo tras un timeout de red sin
haber recibido la respuesta original— la API devuelve la orden ya creada en vez de duplicarla,
incluso si dos requests con la misma key llegan casi al mismo tiempo. Sin el header, cada request
crea una orden nueva. La key es única **por usuario**, y su formato es `[A-Za-z0-9_.:-]{1,255}` —
un UUID entra, y también un `retry-1`.

En `postman/` hay una colección completa de ejemplos ejecutables, con test scripts.

## Testing

```bash
npm test           # unit (rápidos, sin red ni DB)
npm run test:cov   # ídem + cobertura, con umbral mínimo
npm run test:e2e   # e2e contra un Postgres real descartable (requiere Docker)
npm run test:postman  # colección Postman con Newman (requiere el server corriendo)
```

**Unit** (122 tests): un spec por servicio y por controller, con repositorios y servicios mockeados
en memoria. Los tests de controller verifican la delegación; la lógica de negocio se prueba en los
services. La cobertura se mide solo sobre services y controllers —los archivos declarativos
(módulos, entities, DTOs, migraciones) están excluidos a propósito— y está en 100% de statements.

**E2E** (52 tests): levantan un Postgres real y descartable con
[Testcontainers](https://node.testcontainers.org/), le corren **las migraciones reales del proyecto**
y un seed de test propio, y ejercitan la app de punta a punta (HTTP → controller → service → DB),
incluidos los tres escenarios de concurrencia. Nunca tocan la base de Cocos: el container se crea y
se destruye en cada corrida.

Cada bloque con estado crea su propio usuario, así que ninguno depende del orden de ejecución. Se
puede correr uno solo:

```bash
npx jest --config ./test/jest-e2e.json -t "Concurrencia real"
```

**CI** (`.github/workflows/ci.yml`): en cada push y PR a `main` corre lint (sin `--fix`, falla si hay
algo para corregir), type-check, unit + cobertura, e2e y el build de producción. No necesita ningún
secret: el e2e resuelve su propia base efímera.

## Estructura

```
.github/workflows/ci.yml   # lint + type-check + unit + e2e + build
Dockerfile                 # multi-stage: build (nest build) + runtime (solo prod deps + dist)
docker-compose.yml         # levanta solo la API; la DB es la Neon remota
src/
  config/config.ts         # todas las env vars del proyecto, en un solo lugar
  logging/                 # nestjs-pino: JSON + x-request-id por request
  common/dto/              # PaginationQueryDto + PaginatedResponseDto (compartidos)
  database/
    entities/              # User, Instrument, Order, MarketData — 1:1 con las columnas reales
    migrations/            # única fuente de verdad del esquema
    data-source.ts         # DataSource compartido (Nest + CLI de migraciones)
    advisory-lock.ts       # primitivo de lock por key, genérico
  valuation/               # cash disponible + posiciones (compartido)
  portfolio/               # GET /portfolio/:userId
  instruments/             # GET /instruments/search
  orders/
    orders.service.ts          # orquestación: valida y delega
    order-pricing.service.ts   # reglas de precio/size/status de BUY/SELL
    idempotent-order-writer.ts # idempotencia + guardado bajo el advisory lock
  health/                  # GET /health
test/
  app.e2e-spec.ts          # e2e contra Postgres real (Testcontainers)
  setup/                   # container + migraciones + seed de test
postman/                   # colección + test scripts
```

Cada archivo de `src/` tiene su `.spec.ts` al lado.

## Documentación

- **[DECISIONS.md](DECISIONS.md)** — por qué el código es como es: concurrencia, testing, precisión
  numérica, cálculo del portfolio, idempotencia, y las limitaciones conocidas.
- **[CONTRIBUTING.md](CONTRIBUTING.md)** — convención de ramas, commits y PRs. `main` tiene branch
  protection: todo pasa por PR con CI en verde.
