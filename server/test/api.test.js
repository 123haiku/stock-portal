import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { rmSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

// Each run uses a throwaway database file so assertions never depend on prior state.
const here = dirname(fileURLToPath(import.meta.url));
const dbPath = join(here, 'test.db');

for (const suffix of ['', '-wal', '-shm']) {
  if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix, { force: true });
}
process.env.DB_PATH = dbPath;
process.env.JWT_SECRET = 'test-secret';

const { createApp, initDb, db } = await import('../src/index.js');

let server;
let base;
let token;

before(async () => {
  initDb();
  await new Promise((resolve) => {
    server = createApp().listen(0, resolve);
  });
  base = `http://localhost:${server.address().port}`;

  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@portal.local', password: 'demo1234' }),
  });
  const data = await res.json();
  token = data.token;
});

after(async () => {
  await new Promise((resolve) => server.close(resolve));
  // Close the SQLite handle before deleting the file, otherwise Windows keeps it locked.
  db.close();
  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(dbPath + suffix)) rmSync(dbPath + suffix, { force: true });
  }
});

const authed = (path, options = {}) =>
  fetch(`${base}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(options.headers || {}),
    },
  });

test('health endpoint is public', async () => {
  const res = await fetch(`${base}/api/health`);
  assert.equal(res.status, 200);
  assert.equal((await res.json()).ok, true);
});

test('login rejects a wrong password', async () => {
  const res = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@portal.local', password: 'wrong' }),
  });
  assert.equal(res.status, 401);
});

test('products require a token', async () => {
  const res = await fetch(`${base}/api/products`);
  assert.equal(res.status, 401);
});

test('products reject a tampered token', async () => {
  const res = await fetch(`${base}/api/products`, {
    headers: { Authorization: `Bearer ${token.slice(0, -3)}xxx` },
  });
  assert.equal(res.status, 401);
});

test('product search filters by SKU and name', async () => {
  const bySku = await (await authed('/api/products?q=PT-0101')).json();
  assert.equal(bySku.count, 1);
  assert.equal(bySku.items[0].sku, 'PT-0101');

  const byName = await (await authed('/api/products?q=hammer')).json();
  assert.equal(byName.count, 1);
  assert.equal(byName.items[0].sku, 'HT-0001');
});

test('low stock endpoint returns only products at or below reorder level', async () => {
  const data = await (await authed('/api/products/low-stock')).json();
  assert.ok(data.count >= 3);
  for (const item of data.items) {
    assert.ok(item.stock_qty <= item.reorder_level, `${item.sku} is not low`);
  }
});

test('creating a quote deducts stock and computes tax', async () => {
  const before = await (await authed('/api/products?q=PT-0104')).json();
  const startStock = before.items[0].stock_qty;
  const unitPrice = before.items[0].unit_price;

  const res = await authed('/api/quotes', {
    method: 'POST',
    body: JSON.stringify({
      customerName: 'Test Buyer Sdn Bhd',
      items: [{ productId: before.items[0].id, qty: 2 }],
    }),
  });
  assert.equal(res.status, 201);

  const quote = await res.json();
  assert.match(quote.quoteNo, /^Q-\d{8}-\d{4}$/);
  assert.equal(quote.subtotal, Number((unitPrice * 2).toFixed(2)));
  assert.equal(quote.total, Number((quote.subtotal * 1.06).toFixed(2)));

  const after = await (await authed('/api/products?q=PT-0104')).json();
  assert.equal(after.items[0].stock_qty, startStock - 2);
});

test('insufficient stock rolls the whole transaction back', async () => {
  const hammer = (await (await authed('/api/products?q=HT-0002')).json()).items[0];
  const gloves = (await (await authed('/api/products?q=SF-0203')).json()).items[0];

  const res = await authed('/api/quotes', {
    method: 'POST',
    body: JSON.stringify({
      customerName: 'Rollback Buyer',
      items: [
        { productId: hammer.id, qty: 1 },
        { productId: gloves.id, qty: gloves.stock_qty + 50 },
      ],
    }),
  });
  assert.equal(res.status, 400);
  const body = await res.json();
  assert.match(body.error, /insufficient stock/);

  // The first line must not have been deducted: the transaction rolled back.
  const hammerAfter = (await (await authed('/api/products?q=HT-0002')).json()).items[0];
  assert.equal(hammerAfter.stock_qty, hammer.stock_qty);
});

test('quote rejects an empty item list', async () => {
  const res = await authed('/api/quotes', {
    method: 'POST',
    body: JSON.stringify({ customerName: 'Nobody', items: [] }),
  });
  assert.equal(res.status, 400);
});

test('quote detail returns line items', async () => {
  const list = await (await authed('/api/quotes')).json();
  assert.ok(list.count >= 1);

  const detail = await (await authed(`/api/quotes/${list.items[0].id}`)).json();
  assert.equal(detail.id, list.items[0].id);
  assert.ok(Array.isArray(detail.items));
  assert.ok(detail.items.length >= 1);
});

test('unknown quote returns 404', async () => {
  const res = await authed('/api/quotes/999999');
  assert.equal(res.status, 404);
});
