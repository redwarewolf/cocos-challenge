-- Seed de test determinístico — separado a propósito de las migraciones (que solo
-- versionan esquema, no datos): esto NO es el seed real de Cocos, es uno propio y
-- más chico, pensado para que los asserts de los e2e no dependan de datos externos.
-- Se corre después de aplicar las migraciones reales contra el Postgres efímero de
-- Testcontainers (ver test/setup/test-database.ts).

-- 2 usuarios (uno fondeado, uno sin cash), 1 moneda (ARS) + 1 acción (GGAL),
-- 2 días de marketdata para GGAL, y solo el CASH_IN inicial del usuario 1.
-- El resto de los movimientos los generan los propios tests contra la API.

INSERT INTO users (id, email, accountNumber) VALUES
  (1, 'user1@test.com', '90001'),
  (2, 'user2@test.com', '90002');

-- Se agregan BBAR/BHIP/BPAT (además de BMA) para poder probar paginado real:
-- 4 instrumentos que matchean "banco" por nombre, suficiente para ejercitar
-- más de una página con un limit chico.
INSERT INTO instruments (id, ticker, "name", "type") VALUES
  (1, 'ARS', 'PESOS', 'MONEDA'),
  (2, 'GGAL', 'Grupo Financiero Galicia', 'ACCIONES'),
  (3, 'BMA', 'Banco Macro S.A.', 'ACCIONES'),
  (4, 'BBAR', 'Banco Frances', 'ACCIONES'),
  (5, 'BHIP', 'Banco Hipotecario S.A.', 'ACCIONES'),
  (6, 'BPAT', 'Banco Patagonia', 'ACCIONES');

INSERT INTO marketdata (instrumentId, "date", "open", high, low, "close", previousclose) VALUES
  (2, '2024-01-01', 780.00, 810.00, 775.00, 800.00, 790.00),
  (2, '2024-01-02', 800.00, 910.00, 795.00, 900.00, 800.00);

INSERT INTO orders (instrumentId, userId, size, price, side, status, "type", datetime) VALUES
  (1, 1, 100000, 1, 'CASH_IN', 'FILLED', 'MARKET', '2024-01-01 10:00:00');

SELECT setval('users_id_seq', (SELECT MAX(id) FROM users));
SELECT setval('instruments_id_seq', (SELECT MAX(id) FROM instruments));
SELECT setval('orders_id_seq', (SELECT MAX(id) FROM orders));
