# Decisiones de diseño

Por qué el código es como es. Ordenado por relevancia, no por orden cronológico: arriba están las
decisiones que más definen el proyecto, abajo las que son preferencias razonables.

Para setup, endpoints y cómo correr los tests, ver el [README](README.md).

---

## 1. Concurrencia: advisory lock por usuario

Es la decisión que más condiciona el diseño, y no estaba en el enunciado.

No hay tabla de balances ni de posiciones: el disponible y la tenencia se derivan de `orders` en
cada request. Eso significa que dos órdenes del mismo usuario enviadas casi al mismo tiempo pueden
leer el mismo "disponible" antes de que ninguna se haya guardado, **pasar las dos la validación**, y
terminar gastando más pesos o vendiendo más acciones de las que el usuario tiene.

`IdempotentOrderWriter` envuelve el cálculo del disponible y el insert de la orden en una
transacción con `pg_advisory_xact_lock(LockNamespace.USER, userId)` (vía `AdvisoryLock`),
serializando toda creación de órdenes o movimientos de un mismo usuario — BUY/SELL de cualquier
instrumento, CASH_IN/CASH_OUT — sin bloquear a usuarios distintos entre sí. `PATCH
/orders/:id/cancel` corre bajo el mismo lock: es la otra escritura que toca el disponible, aunque
solo lo libere.

La key va con namespace porque Postgres tiene un único espacio de advisory locks. Con el `userId`
pelado, el usuario 5 y cualquier otra entidad que alguna vez se lockee con id 5 se serializarían
entre sí sin tener nada que ver.

**Por qué un advisory lock y no `SELECT ... FOR UPDATE`**: `FOR UPDATE` necesita una fila que
lockear, y acá no hay ninguna. El recurso en disputa es un agregado calculado sobre muchas filas,
no un registro. Lockear la fila del usuario en `users` funcionaría, pero convierte una tabla de
datos maestros en un mutex, que es un uso que nadie espera al leer el esquema. Un advisory lock dice
exactamente lo que hace: serializar por una key.

**Por qué no `SERIALIZABLE`**: sería correcto, pero mueve el problema al cliente — hay que manejar
`serialization_failure` y reintentar. Para un único punto de contención conocido, un lock explícito
es más simple y no le pasa la responsabilidad al que llama.

**Por qué no hace falta lockear entre usuarios**: el enunciado aclara que no hay que simular el
mercado, así que cada orden se ejecuta unilateralmente contra `marketdata.close` (liquidez asumida
infinita), no contra la orden de otro usuario. No hay recurso compartido entre cuentas.

Verificado con un e2e contra Postgres real (no un mock) que dispara pares de movimientos
concurrentes —2 BUY, 2 SELL y 2 CASH_OUT— individualmente dentro del disponible pero juntos no: en
los tres casos uno queda `FILLED` y el otro `REJECTED`, y el disponible nunca queda negativo.

**La consistencia de lectura es un problema aparte.** El lock protege el invariante de la plata,
pero no alcanza para que un `GET /portfolio` devuelva una foto coherente: sus tres lecturas —cash,
reservado y posiciones— sueltas abren una transacción cada una, y en `READ COMMITTED` una orden que
commitea entre medio la ve una y la otra no. Con $100k y sin posiciones, un MARKET BUY de $50k
concurrente puede hacer que el cash se lea antes del commit y las posiciones después, y el total
informe $150k. No es un sobregiro —nada se escribió mal— pero el patrimonio queda mal. Por eso
`getPortfolio` corre las tres dentro de una única transacción `REPEATABLE READ`, que les da un
snapshot común. No necesita reintentos: en Postgres ese nivel solo falla por conflictos de
escritura, y acá no se escribe nada.

---

## 2. Estrategia de testing

**Los e2e corren las migraciones reales del proyecto**, no un `schema.sql` mantenido a mano. Un
esquema paralelo se desactualiza en silencio; corriendo las migraciones, el verde prueba además que
construyen un esquema funcional desde cero, no solo que funcionan encima de lo que ya existía.

**Contra un Postgres real y descartable** (Testcontainers), no contra la base compartida ni contra un
mock: permite ejercitar features Postgres-específicas de las que depende la lógica —CTEs,
`LATERAL`, `pg_advisory_xact_lock`, `ON CONFLICT DO NOTHING`— que un SQLite en memoria no
reproduce, y garantiza que ninguna corrida pueda tocar datos reales.

**Cada bloque e2e con estado crea su propio usuario** y arma sus propias órdenes, en vez de heredar
lo que dejaron los anteriores. Un test acoplado al orden falla por razones que no tienen que ver con
el código que prueba, y esa señal es peor que no tenerla. El aislamiento además habilita asertar
cantidades exactas: heredando estado hay que conformarse con `greaterThan(0)`, que pasa igual aunque
un filtro devuelva de más.

Los `it` **dentro** de un bloque sí pueden ser una secuencia deliberada (comprar → vender →
cancelar): ahí el orden es el flujo bajo prueba. Lo que se evita es la dependencia *entre* bloques.

**Los unit tests no tocan red ni DB**: repositorios y servicios mockeados en memoria. Los tests de
controller solo verifican la delegación; la lógica de negocio vive y se prueba en los services.

---

## 3. Precisión numérica: `decimal.js`, pero solo donde hace falta

`price` y `close` viajan como `string` desde `pg` (son `NUMERIC` en Postgres) para no perder
precisión al parsear. Encadenar operaciones sobre esos valores como `number` de JS introduce ruido
de punto flotante visible en la respuesta: `100 * 19.9` da `1989.9999999999998`, y de ahí sale un
`performancePct: -1.15e-14` en vez de `0` para una posición sin ganancia ni pérdida.

Se usa `Decimal` donde se encadenan operaciones en JS:

- `getPositions`: `marketValue`, `performancePct`, `dailyReturnPct` y `totalCost`. Este último lo
  necesita de verdad porque el costo promedio es una división que puede no ser exacta (`1000 / 3`).
- `getPortfolio`: la suma de `availableCash` + el `marketValue` de cada posición.
- `resolvePrice`: el `price` de una orden `LIMIT` se redondea a 2 decimales **una sola vez**, antes
  de validar fondos, para que el precio con el que se valida sea el mismo que se persiste.
  (`.toFixed(2)` nativo además redondea mal en casos como `(500.005).toFixed(2)` → `"500.00"`.)

Y deliberadamente **no** se usa en `getAvailableCash`/`getAvailableQuantity`/`getLastClose`: ahí la
suma la hace Postgres en `NUMERIC`, que es aritmética decimal exacta. El valor llega como un string
limpio y solo se parsea una vez, sin encadenar nada — no hay error que introducir, y envolverlo en
`Decimal` sería ceremonia sin efecto.

---

## 4. Cómo se calcula el portfolio

**Cash disponible**: suma de todos los movimientos `FILLED` del usuario — `CASH_IN`/`SELL` suman,
`CASH_OUT`/`BUY` restan, ponderados por `size × price`. El instrumento de cash (`ARS`, tipo
`MONEDA`) se resuelve por ticker en runtime, no se hardcodea su `id`.

**Posiciones** (excluyendo `MONEDA`, solo órdenes `FILLED`):

| Campo | Fórmula |
| --- | --- |
| `quantity` | `Σ size(BUY) − Σ size(SELL)`, se omite el instrumento si el neto es `<= 0` |
| `totalCost` | `Σ (size·price)(BUY) / Σ size(BUY) × quantity` |
| `marketValue` | `quantity × lastPrice`, o `null` |
| `performancePct` | `(marketValue − totalCost) / totalCost × 100`, o `null` |
| `dailyReturnPct` | `(lastPrice − previousClose) / previousClose × 100`, o `null` |
| `totalAccountValue` | `availableCash + Σ marketValue`, salteando las posiciones sin valuar |

### Una tenencia negativa se reporta, no se filtra

El listado descarta los netos que no son positivos, pero por dos motivos distintos. Un neto en cero
es una posición cerrada y se omite sin más. Un neto **negativo** —más ventas `FILLED` que compras—
no es un caso de negocio: la API impide vender de más, así que solo puede venir de datos cargados
por fuera. Se descarta igual, porque valuar un descubierto que el sistema no modela sería inventar
un número, pero queda un `warn` con el usuario y los instrumentos involucrados.

La base provista tiene uno: el usuario 1 sobre `BMA`, con `BUY 20 @ 1540` y `SELL 30 @ 1530`, las
dos `FILLED`. Lo que lo hace visible es la asimetría — la posición no se lista, pero los pesos de esa
venta **sí** están contados en `availableCash`, incluidas las 10 acciones que nunca se compraron.

### Sin cotización el valor es desconocido, no cero

Un instrumento puede no tener `marketdata` — en la base provista hay dos, `IRCP` y `PGR`. Valuar esa
posición en `0` es la respuesta fácil y es incorrecta por partida doble: hunde el `totalAccountValue`
por una tenencia que probablemente valga algo, y produce un `performancePct` de exactamente `-100%`,
un número que se lee como una pérdida total real y no como lo que es, la ausencia de un dato.

Por eso `lastPrice`, `marketValue` y `performancePct` son `null` juntos, y la posición no suma al
total. Es la misma distinción que ya hacía `dailyReturnPct`, aplicada a las otras dos métricas.

`quantity` y `totalCost` sí se informan: salen de las órdenes, no del mercado, así que se conocen
igual. Y `hasUnvaluedPositions` marca que el total quedó incompleto — sin ese flag, un cliente que
solo lee `totalAccountValue` no tendría cómo distinguir una cuenta chica de una mal valuada.

### Costo promedio ponderado, y no flujo de caja neto

La fórmula intuitiva para el costo es `Σ(BUY) − Σ(SELL)`, pero eso no es el costo de la posición: es
la plata neta puesta en el instrumento. Coinciden mientras no haya ventas, y después se separan en la
dirección equivocada.

Con `BUY 10 @ 100` y `SELL 5 @ 300` el costo daría `-500` —un costo negativo no existe— y encima el
`performancePct` cae en el guard `totalCost > 0` y se reporta `0%` justo donde más se ganó.

El caso que **no** se ve es el que importa. Con `BUY 10 @ 100`, `SELL 5 @ 150` y cotización actual
160, esa fórmula da un costo de `250` y un rendimiento de `(800 − 250) / 250 = 220%`: un número
positivo, plausible, sin ningún guard que lo delate, cuando el rendimiento real de la posición es
**60%** (de 100 a 160). Con costo promedio ponderado: `1000 / 10 = 100` de promedio × 5 que quedan =
`500`, y `(800 − 500) / 500 = 60%`.

No es una aproximación de compromiso: multiplicar el precio promedio de compra por la cantidad
remanente *es* el método de costo promedio ponderado, el que usa la contabilidad real.

**Límite conocido**: difiere del promedio ponderado *running* (que recalcula el promedio después de
cada compra) solo si se intercalan compras y ventas. Con `BUY 10 @ 100`, `SELL 5`, `BUY 10 @ 200`, el
running da 2500 sobre 15 unidades y esta fórmula 2250. Si todas las compras preceden a las ventas —el
caso normal— son idénticos. La versión exacta necesita window functions con estado ordenado por
`datetime`.

### Rendimiento total y retorno diario son dos métricas, no una

El enunciado pide dos cosas en dos lugares distintos y la API devuelve las dos.

El "rendimiento total (%)" del listado de activos se calcula contra lo invertido, y el propio
enunciado lo confirma al decir que *"para calcular el valor de mercado, rendimiento y cantidad de
acciones de cada posición usar las órdenes en estado `FILLED`"*: si el rendimiento saliera de
`close`/`previousClose`, las órdenes no participarían del cálculo.

El retorno diario es la métrica que el enunciado pide calcular con esas dos columnas, y va **por
posición**: solo es rendimiento del usuario cuando hay tenencia — sobre un instrumento que no se
posee es dato de mercado. Por eso tampoco está en la búsqueda de instrumentos, donde además
obligaría a un JOIN contra `marketdata` en una query que hoy no la toca.

**No se expone un retorno diario a nivel cuenta**: `totalAccountValue` incluye `availableCash`, que
no tiene retorno diario, así que el porcentaje aplicaría sobre una parte del total y no sobre el
total. Un número que hay que aclarar para que no confunda es peor que no tenerlo.

`previousClose` no se deriva buscando el cierre del día anterior: la columna ya lo trae en la misma
fila de `marketdata`, así que el join que selecciona el último precio resuelve las dos métricas sin
joins extra. Los dos precios viajan en la respuesta porque `dailyReturnPct` no sería auditable sin
ellos — `lastPrice` se podría deducir de `marketValue / quantity` (con pérdida por el redondeo), pero
`previousClose` no sale de ningún otro campo.

---

## 5. Envío de órdenes

### Una orden `NEW` compromete el disponible

Una orden pendiente todavía no movió plata ni acciones, pero ya las tiene apalabradas. Por eso el
disponible se informa en tres números y no en uno: `availableCash` es lo liquidado (movimientos
`FILLED`), `reservedCash` es el notional de las `BUY` en `NEW`, y `buyingPower` es la diferencia —
lo que se puede comprometer en una orden nueva. Lo mismo por posición, con `quantity` y
`reservedQuantity`.

Una orden se valida contra el poder de compra y contra la tenencia vendible, no contra los totales.
Si no fuera así, N órdenes `LIMIT` que individualmente entran podrían en conjunto gastar varias
veces el mismo saldo, o vender varias veces las mismas acciones.

Cancelar una orden `NEW` libera lo comprometido sin ningún paso extra: la reserva no es un registro
aparte que haya que revertir, es el resultado de contar las órdenes que están en `NEW`. Al pasar a
`CANCELLED` dejan de contarse.

- `POST /v1/orders` expone solo `BUY`/`SELL`. El enunciado pide "una orden de compra o venta", así
  que `CASH_IN`/`CASH_OUT` viven en un endpoint aparte en vez de sobrecargar el mismo DTO con campos
  que no aplican a un movimiento de cash (no hay `price` ni `type` MARKET/LIMIT que tenga sentido ahí).
- `size` y `amount` son mutuamente excluyentes. Con `amount`, `size = floor(amount / price)`, y se
  rechaza con `400` si da 0: no se admiten fracciones de acciones.
- `MARKET` usa el último `close`; `LIMIT` requiere `price` en el body.
- La validación de fondos (BUY) o tenencia (SELL) usa el mismo cálculo que el portfolio.
- Sin disponible suficiente, la orden **se persiste igual** con `status = REJECTED` y responde `201`.
  Un request inválido (usuario o instrumento inexistente, `LIMIT` sin `price`, `size` y `amount`
  juntos, operar sobre `MONEDA`) responde `400`/`404` y no persiste nada. La distinción es entre "el
  mercado rechazó una orden válida" y "el request está mal formado".

### Los límites de las columnas se validan en el borde

`orders.size` es `INT`, `orders.price` es `NUMERIC(10, 2)` e `idempotencykey` es `VARCHAR(255)`.
Un valor que excede cualquiera de los tres es un input inválido, y tiene que responder `400` desde
la validación del request: si llega a Postgres, el `QueryFailedError` que devuelve sale como `500` y
le dice al cliente que el server se rompió cuando el problema es suyo.

Los techos viven en `src/database/column-limits.ts`, nombrados por lo que acotan y no por el tipo
SQL, y los consumen los DTOs. Un caso no lo puede expresar un DTO: el `size` que sale de
`floor(amount / price)` puede desbordar aunque `amount` sea válido, porque lo que desborda es el
cociente — ese guard va en `OrderPricingService.resolveSize`, que es donde el número existe.

---

## 6. Idempotencia

Una columna `idempotencykey` en `orders` (nullable, `UNIQUE (userid, idempotencykey)`) en vez de una
tabla aparte de claves: con un solo campo alcanza para este alcance, y la constraint de Postgres
resuelve la atomicidad sin lógica de estado propia. Dos `NULL` nunca chocan entre sí, así que los
requests sin key no se ven afectados.

**La unicidad es por usuario, no global.** La key la elige el cliente —puede ser un UUID, pero
también un `retry-1`—, así que dos cuentas pueden mandar la misma. Con una constraint global, el
segundo usuario recibía la orden del primero, con `userId`, instrumento, size y precio ajenos.

### La orden se busca dos veces, y las dos hacen falta

Si viene la key, se busca una orden **de ese usuario** con ese valor antes de tomar el advisory
lock. Eso resuelve el caso común —el cliente reintentó tras un timeout sin haber recibido la
respuesta original— con un solo `SELECT`, sin encolarse detrás del lock del usuario.

La segunda búsqueda va **adentro** del lock, y es la que da la garantía. Si el request original
todavía está en vuelo, la primera no lo ve; pero el advisory lock se libera recién al commitear, así
que cuando el reintento entra, la fila del original ya es visible. Sin esa segunda búsqueda se
volvería a ejecutar el cálculo de la orden, que puede fallar por motivos que no tienen nada que ver
con el reintento: si entre los dos requests el precio se movió, un `amount` que antes alcanzaba para
una acción ya no alcanza, y el cliente recibe un `400` por una orden que existe y quedó `FILLED`.

Dicho de otra forma: la idempotencia no puede depender de que recalcular sea siempre posible.

El caso raro —dos requests con la misma key llegando tan cerca que ni el segundo lookup los
separa— se resuelve a nivel SQL y no con una excepción: el insert usa `ON CONFLICT DO NOTHING` en
vez de un `INSERT` liso, así que el que pierde la carrera no falla, simplemente no inserta. Como
después del insert la fila ya existe —la haya creado uno u otro— un `findOne` posterior la resuelve,
sin inspeccionar códigos `SQLSTATE` del driver.

---

## 7. Esquema y migraciones

No se modificó ni se quitó ninguna tabla o columna existente: todos los cambios son aditivos.
`src/database/migrations` es la única fuente de verdad del esquema.

- **`InitialSchema`** versiona el `CREATE TABLE` que ya existía en la base provista, con
  `IF NOT EXISTS` — ahí es un no-op, documenta el esquema sin recrearlo. Sin esto, correr
  `migration:run` contra un Postgres vacío fallaba, y los e2e no podrían construir su base desde
  cero. Su `down()` se niega a correr a propósito: un `DROP TABLE` automático sobre la base real
  sería catastrófico.
- **`AddPerformanceIndexes`** agrega tres índices para las queries de disponible, posiciones y
  último precio, que se ejecutan en cada request de portfolio y de envío de orden.
- **`AddOrdersIdempotencyKey`** agrega la columna que soporta el header `Idempotency-Key`.
- **`ScopeIdempotencyKeyToUser`** reemplaza la constraint global por la compuesta `(userid,
  idempotencykey)`. No se corrigió editando la migración anterior porque esa ya se había aplicado:
  reescribir una migración corrida deja el historial de esquema mintiendo sobre lo que pasó.
- **`UniqueMarketdataPerDay`** agrega `UNIQUE (instrumentid, date)` sobre `marketdata`, que es su
  clave natural: la tabla guarda el OHLC diario de cada instrumento. Con dos filas del mismo día
  queda indefinido cuál es "el último precio", y una orden podría ejecutarse contra una mientras el
  portfolio se valúa contra la otra. El índice único reemplaza a `idx_marketdata_instrumentid_date`,
  que cubría las mismas columnas.

`synchronize: false` explícito, para que el ORM nunca intente alterar el esquema por su cuenta.

**Nota para producción**: los índices se crean sin `CONCURRENTLY`, lo que toma un lock que bloquea
escrituras sobre la tabla. Sobre este volumen es instantáneo y no importa. En una tabla grande en
producción iría `CONCURRENTLY` — y eso obliga a sacar la creación de la transacción de la migración,
porque `CREATE INDEX CONCURRENTLY` no puede correr dentro de una. Es un caso donde el DDL
transaccional de Postgres, que acá es una ventaja (el swap de constraints de
`ScopeIdempotencyKeyToUser` fue atómico), deja de estar disponible.

---

## 8. Descomposición de `OrdersService`

`OrdersService` concentraba cuatro responsabilidades —orquestación, idempotencia, advisory lock y
reglas de precio/size/status— en un solo archivo. Quedó separado en tres colaboradores:

- **`AdvisoryLock`** (`src/database/`): el primitivo de lock por key, sin saber nada de órdenes, para
  que cualquier otra feature que necesite serializar por una key numérica lo reuse.
- **`OrderPricingService`**: `resolvePrice`/`resolveSize`/`resolveStatus`, reglas específicas de
  `BUY`/`SELL` que los movimientos de cash no usan.
- **`IdempotentOrderWriter`**: idempotencia y guardado, sin saber qué tipo de orden persiste — recibe
  una función que calcula los datos bajo el lock.

`OrdersService` queda como orquestación pura: valida el input, junta lo que hace falta, delega.

El beneficio concreto está en los tests: probar una regla de precio puntual ahora necesita un mock de
`ValuationService` y nada más, en vez del mock completo de `dataSource.transaction` y
`createQueryBuilder`.

---

## 9. Decisiones menores

**Búsqueda de instrumentos**: prioriza match exacto de ticker, luego prefijo, luego el resto, para
que `"ggal"` devuelva el ticker exacto antes que coincidencias parciales en nombres. Los wildcards de
`LIKE` (`%`, `_`) se escapan antes de armar el patrón — no por inyección (la query va parametrizada)
sino por resultados: sin escapar, `GG_L` devuelve `GGAL` y `%` devuelve el listado entero. Se escapan
también los patrones del ranking, que son `ILIKE` igual.

**Paginación**: offset-based (`page`/`limit`), no por cursor — para miles de instrumentos u órdenes
alcanza y es más simple de consumir. El envelope `{ data, total, page, limit }` se comparte entre los
endpoints paginados. `PAGE_SIZE` configurable por entorno; el máximo por request queda fijo en 100.

Con paginado por offset el orden tiene que ser **total**, o el paginado se vuelve inconsistente: cada
página es una query independiente, y ante filas empatadas Postgres no garantiza la misma posición
relativa entre queries — una fila puede aparecer en dos páginas y otra en ninguna. `GET /v1/orders`
ordena por `datetime DESC`, que no es único, así que desempata por `id DESC`. El arreglo no es tomar
el `datetime` de la DB: `now()` es constante dentro de una transacción y también empataría. Un
timestamp no alcanza como criterio de orden total.

**Configuración**: todas las env vars en `src/config/config.ts`. `getConfig()` es una función y no un
objeto estático para que los valores se resuelvan al llamarla y no al importar el módulo — los e2e
pisan `DATABASE_URL`/`DB_SSL` en runtime antes de bootear la app. Por la misma razón `data-source.ts`
no exporta un objeto de opciones ya resuelto. No se usa `ConfigService` porque el CLI de migraciones
importa este mismo archivo y corre fuera del contenedor de DI de Nest.

**Apagado ordenado**: `enableShutdownHooks()`. Ante un `SIGTERM` —un deploy, un `docker stop`— Nest
deja de aceptar conexiones, espera a que terminen los requests en vuelo y recién ahí cierra el pool.
Sin eso, una orden en curso muere sin respuesta y el cliente no sabe si se ejecutó; con el header
`Idempotency-Key` puede reintentar sin duplicarla.

**Swagger solo fuera de producción**: `/docs` y `/docs-json` describen toda la superficie de la API,
que es información gratuita para quien busca por dónde entrar. En desarrollo el valor de tenerlos
supera al riesgo; en producción no.

**TLS contra la base**: `ssl: true`, no `{ rejectUnauthorized: false }`. Desactivar la verificación
del certificado cifra la conexión pero no valida contra quién, que es la mitad del punto de TLS. Neon
emite certificados de una CA pública, así que la verificación completa funciona sin configuración
extra.

**Logging**: `nestjs-pino`, JSON listo para ingestar en vez de texto a parsear. Cada request recibe
un `x-request-id`, reusando el entrante si tiene forma de id (para no cortar la trazabilidad si hay
un gateway adelante) y generando un UUID si no. Ese valor lo controla quien hace el request y termina
en cada línea de log, así que se valida contra `/^[\w-]{1,128}$/`: lo importante no es el largo sino
los caracteres de control, porque un `\n` inyecta líneas falsas indistinguibles de las reales. Un
header inválido se descarta en silencio — fallar un request por un header de observabilidad sería
peor que ignorarlo. Nivel configurable con `LOG_LEVEL`, `silent` en test, formato pretty solo fuera
de producción.

**Versionado de rutas**: todo bajo `/v1/...`, salvo `GET /health`, que es `VERSION_NEUTRAL` — un
healthcheck no debería depender de qué versión de la API se pida. `/docs` y `/docs-json` tampoco
llevan prefijo, pero por otro motivo: `SwaggerModule` los monta aparte, no como rutas de un
controller, así que el versionado no los alcanza. No se versiona "por las dudas":
no hay clientes reales todavía, pero tener la infraestructura lista evita migrar retroactivamente
todas las rutas el día que un cambio incompatible necesite convivir con clientes existentes.

**Docker**: solo para no depender de tener Node instalado; la base sigue siendo la remota, así que
`docker-compose.yml` no levanta ningún Postgres. `Dockerfile` multi-stage, la imagen final no
incluye el código TypeScript ni el toolchain de build, y el proceso corre con `USER node` — por
default un contenedor corre como root, y ahí cualquier vulnerabilidad de la app tendría permisos de
root sobre el filesystem de la imagen.

**Response DTOs**: documentan con `@ApiProperty` la forma real de cada respuesta para que Swagger
genere un schema útil. No agregan una capa de mapeo: los services siguen devolviendo la
entidad/interface tal cual, estructuralmente idéntica al DTO, así que la respuesta real y lo
documentado no pueden divergir.

**Colección Postman**: cubre los endpoints con un `pm.test()` por request, corrible headless con
Newman. Corre contra la base real —no hay una descartable para Newman como sí la hay para los e2e—
así que cada corrida deja movimientos persistidos; por eso los asserts que dependen del balance usan
montos deliberadamente extremos y la `Idempotency-Key` se genera nueva en cada corrida. No está
integrada a CI: hacerlo bien requeriría levantar un Postgres efímero **y** el server dentro del
pipeline, y los e2e ya cubren la lógica de negocio contra una base real aislada. Acá cumple el rol
de colección entregable y smoke test manual, no de gate.

---

## 10. Limitaciones conocidas

Cosas que están así a propósito, con lo que haría falta para resolverlas.

**El balance se deriva de `orders` en cada request.** Es correcto y auditable, pero es un `SUM` sobre
todas las órdenes del usuario. Con millones de filas haría falta materializar el balance en una
tabla, actualizada en la misma transacción que inserta la orden, o un snapshot periódico + delta.
Los índices actuales alcanzan holgadamente para este volumen.

**No hay autenticación**, y por eso `PATCH /orders/:id/cancel` no valida que la orden sea del
usuario. Un `userId` en el request tampoco lo resolvería: un identificador que manda el propio
cliente no es una autorización sino su apariencia. La pertenencia se valida junto con la identidad, y
la identidad viaja en un token.

**Misma `Idempotency-Key` con body distinto** devuelve la orden original en silencio. Lo canónico es
guardar un hash del request junto con la key y responder `409 Conflict` ante un mismatch.

**El costo promedio no es *running*** (ver sección 4): difiere del exacto solo con compras y ventas
intercaladas.
