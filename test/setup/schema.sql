-- Esquema idéntico al provisto por Cocos (database.sql), recreado en el Postgres
-- efímero de Testcontainers para los tests e2e. Seed mínimo y determinístico,
-- pensado para que los asserts de los tests no dependan de datos externos.

CREATE TABLE users (
  id SERIAL PRIMARY KEY,
  email VARCHAR(255),
  accountNumber VARCHAR(20)
);

CREATE TABLE instruments (
  id SERIAL PRIMARY KEY,
  ticker VARCHAR(10),
  name VARCHAR(255),
  type VARCHAR(10)
);

CREATE TABLE orders (
  id SERIAL PRIMARY KEY,
  instrumentId INT,
  userId INT,
  size INT,
  price NUMERIC(10, 2),
  type VARCHAR(10),
  side VARCHAR(10),
  status VARCHAR(20),
  datetime TIMESTAMP,
  FOREIGN KEY (instrumentId) REFERENCES instruments(id),
  FOREIGN KEY (userId) REFERENCES users(id)
);

CREATE TABLE marketdata (
  id SERIAL PRIMARY KEY,
  instrumentId INT,
  high NUMERIC(10, 2),
  low NUMERIC(10, 2),
  open NUMERIC(10, 2),
  close NUMERIC(10, 2),
  previousClose NUMERIC(10, 2),
  date DATE,
  FOREIGN KEY (instrumentId) REFERENCES instruments(id)
);

-- Seed: 2 usuarios (uno fondeado, uno sin cash), 1 moneda (ARS) + 1 acción (GGAL),
-- 2 días de marketdata para GGAL, y solo el CASH_IN inicial del usuario 1.
-- El resto de los movimientos los generan los propios tests contra la API.

INSERT INTO users (id, email, accountNumber) VALUES
  (1, 'user1@test.com', '90001'),
  (2, 'user2@test.com', '90002');

INSERT INTO instruments (id, ticker, "name", "type") VALUES
  (1, 'ARS', 'PESOS', 'MONEDA'),
  (2, 'GGAL', 'Grupo Financiero Galicia', 'ACCIONES'),
  (3, 'BMA', 'Banco Macro S.A.', 'ACCIONES');

INSERT INTO marketdata (instrumentId, "date", "open", high, low, "close", previousclose) VALUES
  (2, '2024-01-01', 780.00, 810.00, 775.00, 800.00, 790.00),
  (2, '2024-01-02', 800.00, 910.00, 795.00, 900.00, 800.00);

INSERT INTO orders (instrumentId, userId, size, price, side, status, "type", datetime) VALUES
  (1, 1, 100000, 1, 'CASH_IN', 'FILLED', 'MARKET', '2024-01-01 10:00:00');

SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
SELECT setval('instruments_id_seq', (SELECT MAX(id) FROM instruments));
SELECT setval('orders_id_seq', (SELECT MAX(id) FROM orders));
