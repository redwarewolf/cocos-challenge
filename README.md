# Cocos Challenge — Backend

[![CI](https://github.com/redwarewolf/cocos-challenge/actions/workflows/ci.yml/badge.svg)](https://github.com/redwarewolf/cocos-challenge/actions/workflows/ci.yml)

API en NestJS + TypeScript + TypeORM (PostgreSQL) que resuelve el
[backend challenge de Cocos Capital](https://github.com/cocos-capital/cocos-challenge/blob/main/backend-challenge.md):
consulta de portfolio, búsqueda de instrumentos y envío de órdenes al mercado.

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
`/docs-json`.

## Endpoints

### `GET /health`

Healthcheck de _readiness_, no solo liveness: pinguea la conexión real a la DB (`@nestjs/terminus` +
`TypeOrmHealthIndicator`), que es la única dependencia externa de esta API. `200` si la DB responde,
`503` si no.

### `GET /portfolio/:userId`

Valor total de cuenta, pesos disponibles y posiciones del usuario.

```json
{
  "userId": 1,
  "availableCash": 753000,
  "positions": [
    {
      "instrumentId": 47,
      "ticker": "PAMP",
      "name": "Pampa Holding S.A.",
      "quantity": 40,
      "marketValue": 37034,
      "totalCost": 37100,
      "performancePct": -0.18
    }
  ],
  "totalAccountValue": 904784
}
```

### `GET /instruments/search?q=<texto>&page=&limit=`

Busca por ticker y/o nombre (case-insensitive, substring). Excluye el instrumento `MONEDA` (ARS).
Paginado: `page` (default 1) y `limit` (default 20, máximo 100). Respuesta:

```json
{
  "data": [
    {
      "id": 34,
      "ticker": "GGAL",
      "name": "Grupo Financiero Galicia",
      "type": "ACCIONES"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

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

### `GET /orders?userId=&status=&page=&limit=` (bonus, no pedido explícitamente por el challenge)

Historial de órdenes/movimientos de un usuario, más recientes primero. `userId` obligatorio,
`status` opcional (`NEW|FILLED|REJECTED|CANCELLED`), mismo paginado (`page`/`limit`) y mismo
envelope de respuesta que `GET /instruments/search`.

### `PATCH /orders/:id/cancel` (bonus, no pedido explícitamente por el challenge)

Cancela una orden en estado `NEW`. Cualquier otro estado responde `400`.

### Header `Idempotency-Key` (bonus, no pedido explícitamente por el challenge)

`POST /orders` y `POST /orders/cash` aceptan un header opcional `Idempotency-Key`. Si un
cliente reintenta el mismo request (ej. por timeout de red sin haber recibido la respuesta
original) mandando la misma key, la API devuelve la orden ya creada en vez de duplicarla —
incluso si dos requests con la misma key llegan casi al mismo tiempo (ver detalle en
"Decisiones de diseño" más abajo). Sin el header, cada request crea una orden nueva, como
siempre.

Ver `postman/` para una colección completa de ejemplos ejecutables, con test scripts (ver "Colección
Postman + Newman" más abajo).

## Decisiones de diseño y asunciones

**Esquema de base de datos**: no se modificó ni se quitó ninguna tabla o columna existente; los únicos
cambios son aditivos. `src/database/migrations` es la única fuente de verdad del esquema, con tres
migraciones:

- `InitialSchema`: versiona el `CREATE TABLE` que Cocos ya corrió en la Neon real (con
  `IF NOT EXISTS`, así que ahí es un no-op — documenta el esquema, no lo recrea). Se agregó para que
  las migraciones sean autosuficientes: antes, correr `migration:run` contra un Postgres vacío
  fallaba porque asumían que las tablas ya existían. Su `down()` rechaza correr a propósito (un
  `DROP TABLE` automático sobre la base real de Cocos sería catastrófico).
- `AddPerformanceIndexes`: migración aditiva que agrega 3 índices no destructivos para acelerar las
  queries de disponible/posiciones/último precio, que se ejecutan en cada request de portfolio y de
  envío de orden: `orders (userid, status)`, `orders (instrumentid, status)`,
  `marketdata (instrumentid, date DESC)`.
- `AddOrdersIdempotencyKey`: agrega la columna `orders.idempotencykey` (nullable, `UNIQUE`) que
  soporta el header `Idempotency-Key` (ver "Idempotencia" más abajo).

Se corren con `npm run migration:run`. `TypeOrmModule` se configura con `synchronize: false`
explícitamente para que el ORM nunca intente alterar el esquema por su cuenta. Los e2e corren estas
mismas migraciones contra el Postgres efímero de Testcontainers (en vez de un `schema.sql` mantenido
a mano, que existió brevemente y se sacó) — de yapa, esto prueba que las migraciones realmente
construyen un esquema funcional desde cero, no solo que funcionan encima de lo que Cocos ya armó.

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
gastando más pesos o vendiendo más acciones de las que el usuario realmente tiene. `IdempotentOrderWriter`
(`src/orders/idempotent-order-writer.ts`) envuelve el cálculo del disponible + el insert de la orden
en una transacción con `pg_advisory_xact_lock(userId)` (vía `AdvisoryLock`, ver "Descomposición de
`OrdersService`" más abajo), serializando toda creación de órdenes/movimientos de un mismo usuario
(BUY/SELL de cualquier instrumento, o CASH_IN/CASH_OUT) sin bloquear a otros usuarios entre sí. No hace falta lockear entre usuarios distintos ni "emparejar"
compra con venta: el challenge aclara que no hace falta simular el mercado, así que cada orden se
ejecuta unilateralmente contra `marketdata.close` (liquidez asumida infinita), no contra la orden de
otro usuario. Verificado tanto a mano contra la base real como con un test e2e automatizado
(`test/app.e2e-spec.ts`, describe "Concurrencia real") que dispara pares de movimientos concurrentes
(2 BUY, 2 SELL y 2 CASH_OUT) contra un Postgres real de Testcontainers, individualmente dentro del
disponible pero juntos no: en los tres casos uno queda `FILLED` y el otro `REJECTED`, sin que el
disponible/tenencia queden nunca negativos.

**Idempotencia** (`POST /orders` / `POST /orders/cash`, header `Idempotency-Key`): se agregó una
columna `idempotencykey` en `orders`, nullable y `UNIQUE` (migración aditiva
`AddOrdersIdempotencyKey`), en vez de una tabla aparte de claves de idempotencia — con un solo campo
extra alcanza para el alcance de este challenge, y la propia constraint `UNIQUE` de Postgres resuelve
la atomicidad sin necesitar lógica de estado propia (dos `NULL` nunca "chocan" entre sí, así que no
afecta a los requests sin key). Si viene la key, `IdempotentOrderWriter` primero busca una orden ya
guardada con ese valor — caso común, el cliente reintentó tras un timeout sin recibir la respuesta original —
y si existe la devuelve directamente, sin volver a ejecutar la orden ni tomar el lock del usuario. El
caso más raro (dos requests con la misma key llegando casi al mismo tiempo) se resuelve a nivel SQL,
no con una excepción: el insert usa `ON CONFLICT DO NOTHING` (`.orIgnore()` de TypeORM) en vez de un
`INSERT` liso, así que el que pierde la carrera simplemente no inserta nada en vez de fallar; como
después del insert la fila con esa key ya existe en la DB —la haya creado uno u otro— un `findOne`
posterior la resuelve sin necesitar inspeccionar códigos de error (`SQLSTATE`) del driver. Verificado
con tests e2e (reintento secuencial, sin key, y dos requests concurrentes con la misma key) contra un
Postgres real de Testcontainers, y a mano contra la Neon real.

**Precisión numérica** (issue #7): `price`/`close` viajan como `string` desde `pg` (Postgres
`numeric`) para no perder precisión al parsear. Se detectó en la práctica que encadenar operaciones
sobre esos valores como `Number` de JS (floats de doble precisión) dejaba ruido de punto flotante en
las respuestas — ej. `performancePct: -1.1548676206522556e-14` en vez de `0` para una posición sin
ganancia ni pérdida (`100 * 19.9` da `1989.9999999999998` en JS nativo, no `1990`). Se migró a
`decimal.js` puntualmente donde se encadenan operaciones en JS:

- `ValuationService.getPositions`: `marketValue`, `performancePct` (y `totalCost` al pasar por
  `Decimal`, aunque ya llegaba exacto desde Postgres).
- `ValuationService.getPortfolio`: suma de `availableCash` + el `marketValue` de cada posición.
- `OrdersService`: el `price` de una orden `LIMIT` se redondea a 2 decimales una única vez, en
  `resolvePrice` — antes se usaba el valor crudo del cliente (`@IsNumber()` no restringe decimales)
  para validar fondos, y recién se redondeaba con `.toFixed(2)` nativo al guardar, lo que podía dejar
  la validación y el valor persistido ligeramente desalineados (y `.toFixed(2)` nativo tiene su
  propio bug conocido de redondeo, ej. `(500.005).toFixed(2)` da `"500.00"` en vez de `"500.01"`).
  `resolveSize` (`floor(amount / price)`) también pasa por `Decimal`.

Deliberadamente **no** se tocó `getAvailableCash`/`getAvailableQuantity`/`getLastClose`: ahí la suma
la hace Postgres en `NUMERIC` (aritmética decimal exacta), así que el valor ya llega como un string
limpio — solo se lo parsea una vez a `number`, sin encadenar operaciones en JS, así que no hay error
que introducir. Todo lo que sale de la API se redondea explícitamente a 2 decimales (también
`performancePct`, antes sin redondear).

**Orden de la búsqueda de instrumentos**: prioriza match exacto de ticker, luego prefijo de ticker,
luego el resto (contiene en ticker o nombre), para que buscar `"ggal"` devuelva primero el ticker
exacto antes que coincidencias parciales en nombres.

**Paginación**: offset-based (`page`/`limit`, `getManyAndCount()`/`findAndCount()`), no por cursor —
para el volumen de un mercado real (miles de instrumentos u órdenes, no millones) alcanza y es más
simple de consumir. El envelope `{ data, total, page, limit }` y el
`PaginationQueryDto`/`PaginatedResponseDto` (factory de Swagger, `src/common/dto/`) se comparten
entre `GET /instruments/search` y `GET /orders`, así que agregar un tercer endpoint paginado no
requeriría reinventar el esquema de respuesta. El tamaño de página default es configurable por
entorno (`PAGE_SIZE`, ver `.env.example`; default 20 si no se define); el máximo permitido por
request queda fijo en 100 (no es una env var, es solo una protección básica).

**Configuración centralizada**: todas las variables de entorno del proyecto (`DATABASE_URL`,
`DB_SSL`, `PORT`, `PAGE_SIZE`) se leen en un único lugar, `src/config/config.ts`, en vez de estar
dispersas por archivo. `getConfig()` (no un objeto estático) resuelve `DATABASE_URL`/`DB_SSL`/`PORT`
recién cuando se llama, no al importar el módulo: los tests e2e pisan esas variables en runtime
antes de bootear la app para apuntar al Postgres de Testcontainers, y si `config.ts` las capturara
una sola vez al cargarse podrían quedar "congeladas" con el valor real de `.env` (según qué módulo
las importe primero). No se usa `ConfigService` de `@nestjs/config` (aunque está instalado y
`ConfigModule` sigue wireado en `AppModule`) porque este mismo archivo lo importa también el CLI de
migraciones (`migration:run`/`migration:revert`), que corre completamente fuera del contenedor de
DI de Nest — un `ConfigService` inyectable no serviría ahí. `PAGE_SIZE` sí se resuelve una sola vez
al importar el módulo, porque a diferencia de `DATABASE_URL` ningún test lo pisa en runtime.

**Logging estructurado y correlation id** (issue #9): reemplaza el logger default de Nest (texto
plano) por `nestjs-pino` — logs en JSON, listos para ingestar por cualquier herramienta de
observabilidad, en vez de líneas de texto a parsear. Cada request recibe un `x-request-id`
(`src/logging/logger.config.ts`, `genReqId`): si el cliente/proxy ya mandó ese header se reusa (no
corta la trazabilidad end-to-end si hay un gateway adelante), si no se genera un UUID nuevo — en
ambos casos se devuelve también en la respuesta. `pino-http` (que trae `nestjs-pino`) loguea
automáticamente cada request/response con ese id, método, url, status y tiempo de respuesta, sin
tocar los controllers/services — alcanza para reconstruir el orden temporal de requests
concurrentes (el motivador original: diagnosticar problemas como el que ya se encontró y corrigió
con el advisory lock, ver "Concurrencia" más arriba). Nivel configurable con `LOG_LEVEL`
(`fatal|error|warn|info|debug|trace`, default `info`), pero fijo en `silent` cuando `NODE_ENV=test`
(lo fija Jest solo) para no ensuciar la salida de `npm test`/`npm run test:e2e`, sin importar
`LOG_LEVEL`. Formato "pretty" (legible) solo fuera de producción — el `Dockerfile` corre con
`NODE_ENV=production`, ahí interesa JSON crudo para una herramienta de logs, no texto formateado a
mano. `main.ts` usa `bufferLogs: true` + `app.useLogger()` para que hasta los logs de arranque de
Nest (inicialización de módulos, rutas mapeadas) salgan formateados por pino, no por el logger
default.

**Response DTOs**: `OrderResponseDto`, `InstrumentResponseDto`, `PortfolioResponseDto` (en cada
módulo, carpeta `dto/`) documentan con `@ApiProperty` la forma real de cada respuesta para que
Swagger genere un schema útil — antes los controllers devolvían entidades TypeORM/interfaces sin
decorar y `/docs` no podía mostrar más que la `description` en texto libre. No agregan una capa de
mapeo: los services siguen devolviendo la entidad/interface tal cual (estructuralmente idéntica al
DTO), así que no hay riesgo de que la respuesta real y lo documentado en Swagger diverjan.

**Descomposición de `OrdersService`** (issue #35): `OrdersService` mezclaba cuatro
responsabilidades — orquestación, idempotencia, el advisory lock, y las reglas de precio/size/status
de `BUY`/`SELL` — en un solo archivo de 337 líneas. Se separó en tres colaboradores con una
responsabilidad cada uno:

- `AdvisoryLock` (`src/database/`): el primitivo de lock por key, sin saber nada de órdenes — para
  que cualquier otra feature futura que necesite serializar por `userId` (o cualquier otra key
  numérica) lo reuse, en vez de reimplementarlo.
- `OrderPricingService`: `resolvePrice`/`resolveSize`/`resolveStatus`, las reglas específicas de
  `BUY`/`SELL` (`createCashMovement` no las usa).
- `IdempotentOrderWriter`: la idempotencia y el guardado (`ON CONFLICT DO NOTHING`), sin saber qué
  tipo de orden está guardando — recibe una función que calcula los datos bajo el lock.

`OrdersService` queda como orquestación pura: valida el input, junta lo que hace falta (usuario,
instrumento), y delega. El beneficio más concreto es en los tests: antes, probar una regla de precio
puntual (ej. el redondeo de un `LIMIT`) requería armar el mock completo de
`dataSource.transaction`/`createQueryBuilder`; ahora `order-pricing.service.spec.ts` la prueba con
un mock de `ValuationService` nada más. La cobertura de `src/` pasó de ~99% a 100% de statements
como efecto directo de que cada pieza se volvió más fácil de testear de forma aislada.

## Testing

```bash
npm test          # unit tests (rápidos, sin red/DB)
npm run test:cov  # ídem + reporte de cobertura (con umbral mínimo configurado)
npm run test:e2e  # e2e contra un Postgres real descartable (requiere Docker)
```

**Unit tests** (`src/**/*.spec.ts`, 103 tests): uno por servicio/colaborador y uno por controller,
con los repositorios/`EntityManager`/servicios mockeados en memoria — no dependen de la red ni de la
base compartida, así que corren rápido y determinísticamente (ninguno requiere Docker). Los tests de
controller solo verifican la delegación (que llaman al método del service correcto con los
argumentos correctos); la lógica de negocio real vive y se testea en los services. El test funcional
que pide el challenge sobre el envío de órdenes queda repartido según responsabilidad (issue #35):
`order-pricing.service.spec.ts` cubre MARKET/LIMIT, cálculo de `size` desde `amount`, y rechazo por
fondos/tenencia insuficientes; `idempotent-order-writer.spec.ts` y `advisory-lock.spec.ts` cubren la
idempotencia y que el lock se pida antes de ejecutar; `orders.service.spec.ts` cubre la orquestación
(validaciones de input, 404s, cancelación) sin necesitar mockear transacciones ni query builders.
`collectCoverageFrom` (en `package.json`) excluye a propósito `*.module.ts`,
`main.ts`, `data-source.ts`, `database/migrations/**`, `database/entities/**` y `**/dto/**`: son
archivos declarativos (decorators de Nest/TypeORM/class-validator, wiring de DI, SQL de migración),
sin ramas ni cómputo que un unit test pueda ejercitar de forma significativa — están cubiertos igual,
pero por los e2e (que sí bootean la app entera) o, en el caso de la migración, por haberla corrido
contra la DB real. Con esa exclusión, `npm run test:cov` reporta cobertura solo de `services` y
`controllers` (la lógica real): 100% statements / ~85% branches / 100% functions / 100% lines,
con un `coverageThreshold` en `package.json` un poco por debajo de eso para detectar regresiones sin
ser un número arbitrario.

**E2E tests** (`test/app.e2e-spec.ts`, 47 tests): levantan un Postgres real y descartable con
[Testcontainers](https://node.testcontainers.org/) (`test/setup/test-database.ts`), le corren las
migraciones reales del proyecto (no un esquema hardcodeado — issue #27) y cargan
`test/setup/seed.sql` (seed propio y determinístico, no el de Cocos), y corren la app de punta a
punta (HTTP → controller → service → DB) contra los 4 endpoints, incluyendo
los dos escenarios de concurrencia real (ver "Concurrencia" arriba). Nunca tocan la base de Cocos: el
container se crea y se destruye en cada corrida. Para que esto funcione, `TypeOrmModule` pasó de
`forRoot(dataSourceOptions)` a `forRootAsync({ useFactory: buildDataSourceOptions })`
(`src/database/data-source.ts`) — la conexión se resuelve recién cuando Nest bootea la app, no al
importar el módulo, así el test puede pisar `DATABASE_URL`/`DB_SSL` _antes_ de ese momento. En
dev/prod normal el comportamiento no cambia.

**CI** (`.github/workflows/ci.yml`): en cada push/PR a `main` corre, en este orden, lint (sin
`--fix`, falla si hay algo para corregir), type-check, unit tests + cobertura, e2e (Testcontainers —
el runner de GitHub Actions ya trae Docker) y el build de producción. No necesita ningún secret: el
e2e resuelve su propia base efímera, nunca la de Cocos.

**Docker** (`Dockerfile`, `docker-compose.yml`): pensado solo para no depender de tener Node
instalado — la base sigue siendo la Neon remota, así que el `docker-compose.yml` no levanta
ningún Postgres, solo la API (lee `DATABASE_URL` de `.env` vía `env_file`). El `Dockerfile` es
multi-stage: una etapa `build` con las devDependencies para compilar (`nest build`), y una
etapa `runtime` liviana que solo instala dependencias de producción (`npm ci --omit=dev`) y
copia el `dist/` ya compilado — la imagen final no incluye el código TypeScript ni el toolchain
de build.

**Colección Postman + Newman** (issue #5, `postman/`): el challenge pide explícitamente "una
colección de Postman, Insomnia o REST Client" — se optó por Postman, con verificación automática.
`postman/cocos-challenge.postman_collection.json` cubre los 4 endpoints con los datos del seed real
(`userId` 1-2, `instrumentId` 34=GGAL/47=PAMP), con un `pm.test()` por request (status code, forma
de la respuesta, y los asserts de negocio que pide el issue — ej. orden `REJECTED` cuando no alcanza
el disponible). Se corre headless con `npm run test:postman` (`newman run ...`), apuntando a
`postman/environment.json` (`baseUrl`, default `http://localhost:3000`) — requiere el server
corriendo de antemano (`npm run start:dev` o `docker compose up`). **Corre contra la Neon real** (no
hay una base descartable para Postman/Newman como sí la hay para los e2e vía Testcontainers), así
que cada corrida deja pedidos/movimientos reales persistidos. Por eso los asserts de casos que
dependen del balance actual del usuario (ej. "se rechaza por fondos insuficientes") usan montos
deliberadamente extremos, para que el resultado sea determinístico sin importar cuánto se haya
gastado en corridas anteriores; y la `Idempotency-Key` de la sección 7 se genera nueva en cada
corrida (timestamp), para no depender de si ya existe una fila con esa key de una corrida previa.
Deliberadamente **no** se integró a `ci.yml`: hacerlo bien requeriría levantar un Postgres efímero +
el server real dentro del pipeline (infraestructura nueva, no solo la colección), y los e2e ya
cubren toda la lógica de negocio —incluida la concurrencia— contra una base real aislada;
Postman/Newman acá cumple el rol de colección entregable + smoke test manual, no de gate de CI.
No se mantiene también una colección de REST Client en paralelo (issue #36): duplicaba exactamente
la misma cobertura en dos formatos a mano, con el mismo riesgo de drift que ya se había corregido
para las migraciones (issue #27).

## Estructura

```
.github/workflows/ci.yml  # lint + type-check + unit + e2e + build en cada push/PR a main
Dockerfile                 # multi-stage: build (nest build) + runtime (solo prod deps + dist)
docker-compose.yml         # levanta solo la API, leyendo DATABASE_URL de .env (la DB es la Neon remota)
src/
  config/config.ts  # todas las env vars del proyecto, en un solo lugar + .spec
  logging/          # logger.config.ts: nestjs-pino (JSON, x-request-id por request) + .spec
  common/dto/       # PaginationQueryDto + PaginatedResponseDto (compartidos entre endpoints)
  database/
    entities/      # User, Instrument, Order, MarketData — mapeadas 1:1 a las columnas reales
    migrations/     # única fuente de verdad del esquema: InitialSchema + índices aditivos
    data-source.ts  # DataSource compartido (Nest + CLI de migraciones)
    advisory-lock.ts # AdvisoryLock: primitivo de lock por key, genérico (no específico de orders) + .spec
  valuation/        # ValuationService: cash disponible + posiciones (compartido) + .spec
  portfolio/        # GET /portfolio/:userId + .spec
  instruments/      # GET /instruments/search + .spec
  orders/           # POST /orders, POST /orders/cash, GET /orders, PATCH /orders/:id/cancel + .spec
    orders.service.ts           # orquestación pura: valida, delega en los colaboradores de abajo
    order-pricing.service.ts    # reglas de precio/size/status de BUY/SELL + .spec
    idempotent-order-writer.ts  # idempotencia + guardado (usa AdvisoryLock) + .spec
  health/           # GET /health (readiness: pinguea la DB) + .spec
test/
  app.e2e-spec.ts   # e2e de los 4 endpoints contra Postgres real (Testcontainers)
  setup/            # helper que levanta el container, corre las migraciones + seed.sql (seed de test)
postman/            # colección de requests + test scripts (npm run test:postman)
```

## Contribuir

Convención de ramas/commits/PRs en [CONTRIBUTING.md](CONTRIBUTING.md). `main` tiene branch
protection: todo pasa por PR y requiere el check de CI en verde.
