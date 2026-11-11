-- Enterprise Stock & Quotation Portal - relational schema
-- Five tables: users, categories, products, quotes, quote_items.

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'sales' CHECK (role IN ('admin', 'sales')),
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS categories (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT    NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS products (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  sku           TEXT    NOT NULL UNIQUE,
  name          TEXT    NOT NULL,
  category_id   INTEGER REFERENCES categories(id),
  unit_price    REAL    NOT NULL CHECK (unit_price >= 0),
  stock_qty     INTEGER NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  reorder_level INTEGER NOT NULL DEFAULT 10,
  updated_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quotes (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_no      TEXT    NOT NULL UNIQUE,
  customer_name TEXT    NOT NULL,
  created_by    INTEGER NOT NULL REFERENCES users(id),
  status        TEXT    NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'sent', 'accepted', 'rejected')),
  subtotal      REAL    NOT NULL DEFAULT 0,
  tax_rate      REAL    NOT NULL DEFAULT 0.06,
  total         REAL    NOT NULL DEFAULT 0,
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS quote_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  quote_id   INTEGER NOT NULL REFERENCES quotes(id) ON DELETE CASCADE,
  product_id INTEGER NOT NULL REFERENCES products(id),
  qty        INTEGER NOT NULL CHECK (qty > 0),
  unit_price REAL    NOT NULL,
  line_total REAL    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_products_sku      ON products(sku);
CREATE INDEX IF NOT EXISTS idx_products_name     ON products(name);
CREATE INDEX IF NOT EXISTS idx_products_low      ON products(stock_qty, reorder_level);
CREATE INDEX IF NOT EXISTS idx_quote_items_quote ON quote_items(quote_id);
CREATE INDEX IF NOT EXISTS idx_quotes_created    ON quotes(created_at DESC);
