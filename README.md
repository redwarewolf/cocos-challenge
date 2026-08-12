# Cocos Challenge — Backend

API en NestJS + TypeScript + TypeORM (PostgreSQL) que resuelve el
[backend challenge de Cocos Capital](https://github.com/cocos-capital/cocos-challenge/blob/main/backend-challenge.md):
consulta de portfolio, búsqueda de instrumentos y envío de órdenes al mercado.

## Requisitos

- Node.js 20+ (probado con Node 22)
- Acceso a la base PostgreSQL provista por Cocos (Neon)

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
- Solo expone `BUY`/`SELL`. El challenge modela las transferencias de cash (`CASH_IN`/`CASH_OUT`)
  como filas de `orders`, pero el enunciado de este endpoint pide explícitamente "una orden de
  compra o venta" — se asume que esos movimientos no se crean vía API en este challenge (podrían
  agregarse como un endpoint aparte si se necesitara).
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
órdenes de un mismo usuario (cualquier instrumento, BUY o SELL) sin bloquear a otros usuarios entre
sí. No hace falta lockear entre usuarios distintos ni "emparejar" compra con venta: el challenge
aclara que no hace falta simular el mercado, así que cada orden se ejecuta unilateralmente contra
`marketdata.close` (liquidez asumida infinita), no contra la orden de otro usuario. Verificado
manualmente contra la base real disparando pares de órdenes concurrentes (2 BUY y 2 SELL) que
individualmente entraban en el disponible pero juntas no: en ambos casos una queda `FILLED` y la
otra `REJECTED`, sin que el disponible/tenencia queden nunca negativos.

**Precisión numérica**: `price`/`close` viajan como `string` desde `pg` (Postgres `numeric`) para no
perder precisión al parsear; los cálculos intermedios se hacen con `Number` en JS. Para un dominio
real de trading se recomendaría una librería de precisión decimal (`decimal.js`), pero para el
alcance de este challenge (montos en pesos con 2 decimales) no se justificó la complejidad extra.

**Orden de la búsqueda de instrumentos**: prioriza match exacto de ticker, luego prefijo de ticker,
luego el resto (contiene en ticker o nombre), para que buscar `"ggal"` devuelva primero el ticker
exacto antes que coincidencias parciales en nombres.

## Testing

```bash
npm test
```

`src/orders/orders.service.spec.ts` es el test funcional pedido por el challenge sobre el envío de
órdenes: cubre MARKET/LIMIT, cálculo de `size` desde `amount`, rechazo por fondos/tenencia
insuficientes, validaciones de input, cancelación, y que el advisory lock se pida (con el `userId`
correcto) antes de leer el disponible. Usa repositorios en memoria (no pega contra la red/DB), para
que corra rápido y de forma determinística sin depender de la base compartida — la serialización
real del lock bajo concurrencia se verificó aparte, a mano, contra la base real (ver sección
"Concurrencia" arriba).

## Estructura

```
src/
  database/
    entities/      # User, Instrument, Order, MarketData — mapeadas 1:1 a las columnas reales
    migrations/     # índices aditivos
    data-source.ts  # DataSource compartido (Nest + CLI de migraciones)
  valuation/        # ValuationService: cash disponible + posiciones (compartido)
  portfolio/        # GET /portfolio/:userId
  instruments/      # GET /instruments/search
  orders/           # POST /orders, PATCH /orders/:id/cancel
rest-client/requests.http
```
