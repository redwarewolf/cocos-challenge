# Cocos Challenge — Backend

[![CI](https://github.com/redwarewolf/cocos-challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/redwarewolf/cocos-challenge/actions/workflows/ci.yml)

API en NestJS + TypeScript + TypeORM (PostgreSQL) que resuelve el
[backend challenge de Cocos Capital](https://github.com/cocos-capital/cocos-challenge/blob/main/backend-challenge.md):
consulta de portfolio, búsqueda de instrumentos y envío de órdenes al mercado.

## Requisitos

- Node.js 20+ (probado con Node 22)
- Acceso a la base PostgreSQL provista por Cocos (Neon)
- Docker corriendo (solo para `npm run test:e2e` — levanta un Postgres descartable vía
  Testcontainers; no hace falta para `npm run start:dev` ni para `npm test`)

## Setup

```bash
npm install
cp .env.example .env   # completar DATABASE_URL con la connection string real
npm run start:dev
```

La API queda escuchando en `http://localhost:3000` (configurable con `PORT`).

## Endpoints

### `GET /portfolio/:userId`

Valor total de cuenta, pesos disponibles y posiciones del usuario.

```json
{
  "userId": 1,
  "availableCash": 753000,
  "positions": [
    { "instrumentId": 47, "ticker": "PAMP", "name": "Pampa Holding S.A.", "quantity": 40, "marketValue": 37034, "totalCost": 37100, "performancePct": -0.177 }
  ],
  "totalAccountValue": 904784
}
```

### `GET /instruments/search?q=<texto>`

Busca por ticker y/o nombre (case-insensitive, substring). Excluye el instrumento `MONEDA` (ARS).

### `POST /orders`

Envía una orden `BUY`/`SELL`, `MARKET`/`LIMIT`.

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
acciones enteras que ese monto permite comprar al precio resuelto).
Para `LIMIT` es obligatorio enviar `"price"`; para `MARKET` se ignora (se usa el último `close`).

### `POST /orders/cash` (bonus, no pedido explícitamente por el challenge)

Deposita (`CASH_IN`) o retira (`CASH_OUT`) pesos de la cuenta de un usuario — útil para fondear
usuarios de prueba sin tocar la base directamente (en el seed original solo el usuario 1 tiene cash).

```json
{ "userId": 2, "side": "CASH_IN", "amount": 50000 }
```

`CASH_IN` siempre se llena; `CASH_OUT` queda `REJECTED` si no hay disponible suficiente (mismo
criterio que un `SELL`). `amount` es un entero en pesos (misma convención que `size`).

### `PATCH /orders/:id/cancel` (bonus, no pedido explícitamente por el challenge)

Cancela una orden en estado `NEW`. Cualquier otro estado responde `400`.

Ver `rest-client/requests.http` para una colección completa de ejemplos ejecutables (extensión
[REST Client](https://marketplace.visualstudio.com/items?itemName=humao.rest-client) de VS Code).

## Decisiones de diseño y asunciones

**Esquema de base de datos**: se mantiene tal cual (no se modificó ninguna tabla ni columna). El
único cambio aplicado es una migración aditiva de TypeORM (`src/database/migrations`) que agrega
3 índices no destructivos para acelerar las queries de disponible/posiciones/último precio, que se
ejecutan en cada request de portfolio y de envío de orden:
- `orders (userid, status)`
- `orders (instrumentid, status)`
- `marketdata (instrumentid, date DESC)`

Se corre con `npm run migration:run`. `TypeOrmModule` se configura con `synchronize: false`
explícitamente para que el ORM nunca intente alterar el esquema por su cuenta.

**Cash disponible**: se calcula sumando todos los movimientos `FILLED` del usuario en la tabla
`orders` — `CASH_IN`/`SELL` suman, `CASH_OUT`/`BUY` restan (todos ponderados por `size * price`).
El instrumento de cash (`ARS`, tipo `MONEDA`) se resuelve por ticker en tiempo de ejecución, no se
hardcodea su `id`.

**Posiciones y rendimiento**: para cada instrumento (excluyendo `MONEDA`) se calcula, usando solo
órdenes `FILLED`:
- `quantity = Σ size(BUY) − Σ size(SELL)` (se omite el instrumento si el neto es `<= 0`).
- `totalCost` (costo neto) `= Σ (size·price)(BUY) − Σ (size·price)(SELL)`: es una aproximación
  simple al costo invertido neto, no un FIFO/promedio ponderado estricto. Para el alcance del
  challenge (sin simular mercado, sin fraccionamiento de acciones) se consideró suficiente y es
  fácil de auditar a partir de las propias órdenes.
- `marketValue = quantity × último close (marketdata)`.
- `performancePct = (marketValue − totalCost) / totalCost × 100` (0 si `totalCost <= 0`).
- `totalAccountValue = availableCash + Σ marketValue`.

Esta lógica vive en un único `ValuationService` (`src/valuation`), reutilizado tanto por
`GET /portfolio/:userId` como por la validación de fondos/tenencia al crear una orden, para no
duplicar el cálculo de "disponible" en dos lugares.

**Envío de órdenes**:
- `POST /orders` solo expone `BUY`/`SELL` — el enunciado de este endpoint pide explícitamente "una
  orden de compra o venta", así que `CASH_IN`/`CASH_OUT` viven en un endpoint aparte
  (`POST /orders/cash`, ver arriba) en vez de sobrecargar el mismo DTO con campos que no aplican a
  un movimiento de cash (no hay `price`/`type` MARKET-LIMIT que tenga sentido ahí).
- `size` y `amount` son mutuamente excluyentes; si se envía `amount`, `size = floor(amount / price)`
  y se rechaza (400) si da 0 (no se admiten fracciones de acciones).
- `MARKET` usa el último `close` de `marketdata`; `LIMIT` requiere `price` en el body.
- La validación de fondos (BUY) o tenencia (SELL) usa el mismo cálculo que el portfolio, sobre
  órdenes `FILLED` actuales — no reserva fondos de otras órdenes `NEW` pendientes, ya que el
  challenge aclara que no hace falta simular el mercado/book de órdenes.
- Si no alcanza el disponible: la orden igual se persiste, con `status = REJECTED` (respuesta 201).
  Errores de request inválido (usuario/instrumento inexistente, `LIMIT` sin `price`, `size` y
  `amount` juntos, operar sobre el instrumento `MONEDA`, etc.) responden `400`/`404` y no se
  persisten.
- Precios se persisten con 2 decimales (`NUMERIC(10,2)`, igual que la columna real).

**Concurrencia**: como no hay una tabla de balances/posiciones (todo se deriva de `orders` en cada
request), dos órdenes del mismo usuario enviadas casi simultáneamente podrían leer el mismo
"disponible" antes de que ninguna se hubiera guardado, pasar la validación las dos, y terminar
gastando más pesos o vendiendo más acciones de las que el usuario realmente tiene. `OrdersService.create`
envuelve la lectura del disponible + el insert de la orden en una transacción con
`pg_advisory_xact_lock(userId)` (`src/orders/orders.service.ts`), serializando toda creación de
órdenes/movimientos de un mismo usuario (BUY/SELL de cualquier instrumento, o CASH_IN/CASH_OUT) sin
bloquear a otros usuarios entre sí. No hace falta lockear entre usuarios distintos ni "emparejar"
compra con venta: el challenge aclara que no hace falta simular el mercado, así que cada orden se
ejecuta unilateralmente contra `marketdata.close` (liquidez asumida infinita), no contra la orden de
otro usuario. Verificado tanto a mano contra la base real como con un test e2e automatizado
(`test/app.e2e-spec.ts`, describe "Concurrencia real") que dispara pares de movimientos concurrentes
(2 BUY, 2 SELL y 2 CASH_OUT) contra un Postgres real de Testcontainers, individualmente dentro del
disponible pero juntos no: en los tres casos uno queda `FILLED` y el otro `REJECTED`, sin que el
disponible/tenencia queden nunca negativos.

**Precisión numérica**: `price`/`close` viajan como `string` desde `pg` (Postgres `numeric`) para no
perder precisión al parsear; los cálculos intermedios se hacen con `Number` en JS. Para un dominio
real de trading se recomendaría una librería de precisión decimal (`decimal.js`), pero para el
alcance de este challenge (montos en pesos con 2 decimales) no se justificó la complejidad extra.

**Orden de la búsqueda de instrumentos**: prioriza match exacto de ticker, luego prefijo de ticker,
luego el resto (contiene en ticker o nombre), para que buscar `"ggal"` devuelva primero el ticker
exacto antes que coincidencias parciales en nombres.

## Testing

```bash
npm test          # unit tests (rápidos, sin red/DB)
npm run test:cov  # ídem + reporte de cobertura (con umbral mínimo configurado)
npm run test:e2e  # e2e contra un Postgres real descartable (requiere Docker)
```

**Unit tests** (`src/**/*.spec.ts`, 49 tests): uno por servicio (`OrdersService`, `ValuationService`,
`PortfolioService`, `InstrumentsService`) y uno por controller (los 3), con los
repositorios/`EntityManager`/servicios mockeados en memoria — no dependen de la red ni de la base
compartida, así que corren rápido y determinísticamente (ninguno requiere Docker). Los tests de
controller solo verifican la delegación (que llaman al método del service correcto con los
argumentos correctos); la lógica de negocio real vive y se testea en los services.
`orders.service.spec.ts` es el test funcional que pide el challenge sobre el envío de órdenes: cubre
MARKET/LIMIT, cálculo de `size` desde `amount`, rechazo por fondos/tenencia insuficientes,
validaciones de input, cancelación, y que el advisory lock se pida (con el `userId` correcto) antes
de leer el disponible. `collectCoverageFrom` (en `package.json`) excluye a propósito `*.module.ts`,
`main.ts`, `data-source.ts`, `database/migrations/**`, `database/entities/**` y `**/dto/**`: son
archivos declarativos (decorators de Nest/TypeORM/class-validator, wiring de DI, SQL de migración),
sin ramas ni cómputo que un unit test pueda ejercitar de forma significativa — están cubiertos igual,
pero por los e2e (que sí bootean la app entera) o, en el caso de la migración, por haberla corrido
contra la DB real. Con esa exclusión, `npm run test:cov` reporta cobertura solo de `services` y
`controllers` (la lógica real): ~98.7% statements / ~82.7% branches / 100% functions / ~98.6% lines,
con un `coverageThreshold` en `package.json` un poco por debajo de eso para detectar regresiones sin
ser un número arbitrario.

**E2E tests** (`test/app.e2e-spec.ts`, 32 tests): levantan un Postgres real y descartable con
[Testcontainers](https://node.testcontainers.org/) (`test/setup/test-database.ts` +
`test/setup/schema.sql`, mismo esquema que `database.sql` con un seed propio y determinístico), y
corren la app de punta a punta (HTTP → controller → service → DB) contra los 4 endpoints, incluyendo
los dos escenarios de concurrencia real (ver "Concurrencia" arriba). Nunca tocan la base de Cocos: el
container se crea y se destruye en cada corrida. Para que esto funcione, `TypeOrmModule` pasó de
`forRoot(dataSourceOptions)` a `forRootAsync({ useFactory: buildDataSourceOptions })`
(`src/database/data-source.ts`) — la conexión se resuelve recién cuando Nest bootea la app, no al
importar el módulo, así el test puede pisar `DATABASE_URL`/`DB_SSL` *antes* de ese momento. En
dev/prod normal el comportamiento no cambia.

**CI** (`.github/workflows/ci.yml`): en cada push/PR a `main` corre, en este orden, lint (sin
`--fix`, falla si hay algo para corregir), type-check, unit tests + cobertura, e2e (Testcontainers —
el runner de GitHub Actions ya trae Docker) y el build de producción. No necesita ningún secret: el
e2e resuelve su propia base efímera, nunca la de Cocos.

## Estructura

```
.github/workflows/ci.yml  # lint + type-check + unit + e2e + build en cada push/PR a main
src/
  database/
    entities/      # User, Instrument, Order, MarketData — mapeadas 1:1 a las columnas reales
    migrations/     # índices aditivos
    data-source.ts  # DataSource compartido (Nest + CLI de migraciones)
  valuation/        # ValuationService: cash disponible + posiciones (compartido) + .spec
  portfolio/        # GET /portfolio/:userId + .spec
  instruments/      # GET /instruments/search + .spec
  orders/           # POST /orders, POST /orders/cash, PATCH /orders/:id/cancel + .spec
test/
  app.e2e-spec.ts   # e2e de los 4 endpoints contra Postgres real (Testcontainers)
  setup/            # helper que levanta/destruye el container + schema.sql (esquema + seed de test)
rest-client/requests.http
```

## Contribuir

Convención de ramas/commits/PRs en [CONTRIBUTING.md](CONTRIBUTING.md). `main` tiene branch
protection: todo pasa por PR y requiere el check de CI en verde.
