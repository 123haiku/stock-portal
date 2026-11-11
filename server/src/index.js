import { createServer } from 'node:http';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import bcrypt from 'bcryptjs';
import { db, initDb, all, get, run, transaction } from './db.js';

const PORT = Number(process.env.PORT || 4000);
const JWT_SECRET = process.env.JWT_SECRET || 'dev-secret-change-me';
const TOKEN_TTL_MS = 8 * 60 * 60 * 1000;

// ---------------------------------------------------------------- JWT (HS256)

const b64url = (buf) =>
  Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const unb64url = (str) =>
  Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function signToken(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify({ ...payload, iat: Date.now() }));
  const sig = b64url(createHash('sha256').update(`${header}.${body}.${JWT_SECRET}`).digest());
  return `${header}.${body}.${sig}`;
}

function verifyToken(token) {
  const parts = String(token || '').split('.');
  if (parts.length !== 3) return null;
  const [header, body, sig] = parts;
  const expected = b64url(createHash('sha256').update(`${header}.${body}.${JWT_SECRET}`).digest());
  if (sig !== expected) return null;
  try {
    const payload = JSON.parse(unb64url(body));
    if (Date.now() - payload.iat > TOKEN_TTL_MS) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- helpers

function send(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1e6) reject(new Error('payload too large'));
    });
    req.on('end', () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new Error('invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}

function auth(req) {
  const header = req.headers.authorization || '';
  if (!header.startsWith('Bearer ')) return null;
  return verifyToken(header.slice(7));
}

// ---------------------------------------------------------------- routes

const routes = [];
const route = (method, pattern, handler) => routes.push({ method, pattern, handler });

route('GET', /^\/api\/health$/, () => ({ status: 200, body: { ok: true, ts: Date.now() } }));

route('POST', /^\/api\/auth\/login$/, async (req) => {
  const { email, password } = await readJson(req);
  if (!email || !password) return { status: 400, body: { error: 'email and password required' } };

  const user = get('SELECT * FROM users WHERE email = ?', [email]);
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return { status: 401, body: { error: 'invalid credentials' } };
  }

  return {
    status: 200,
    body: {
      token: signToken({ uid: user.id, role: user.role, email: user.email }),
      user: { id: user.id, email: user.email, role: user.role },
    },
  };
});

route('GET', /^\/api\/products$/, (req, _params, url) => {
  const session = auth(req);
  if (!session) return { status: 401, body: { error: 'missing or invalid token' } };

  const q = (url.searchParams.get('q') || '').trim();
  const lowStock = url.searchParams.get('lowStock') === '1';
  const limit = Math.min(Number(url.searchParams.get('limit')) || 50, 200);

  const where = [];
  const params = [];
  if (q) {
    where.push('(p.sku LIKE ? OR p.name LIKE ?)');
    params.push(`%${q}%`, `%${q}%`);
  }
  if (lowStock) where.push('p.stock_qty <= p.reorder_level');

  const rows = all(
    `SELECT p.id, p.sku, p.name, p.unit_price, p.stock_qty, p.reorder_level,
            c.name AS category, p.updated_at
       FROM products p
       LEFT JOIN categories c ON c.id = p.category_id
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY p.sku
      LIMIT ?`,
    [...params, limit],
  );

  return { status: 200, body: { count: rows.length, items: rows } };
});

route('GET', /^\/api\/products\/low-stock$/, (req) => {
  const session = auth(req);
  if (!session) return { status: 401, body: { error: 'missing or invalid token' } };

  const rows = all(
    `SELECT sku, name, stock_qty, reorder_level
       FROM products
      WHERE stock_qty <= reorder_level
      ORDER BY (stock_qty - reorder_level) ASC`,
  );
  return { status: 200, body: { count: rows.length, items: rows } };
});

route('GET', /^\/api\/quotes$/, (req) => {
  const session = auth(req);
  if (!session) return { status: 401, body: { error: 'missing or invalid token' } };

  const rows = all(
    `SELECT q.id, q.quote_no, q.customer_name, q.status, q.subtotal, q.tax_rate, q.total,
            q.created_at, u.email AS created_by
       FROM quotes q
       JOIN users u ON u.id = q.created_by
      ORDER BY q.id DESC
      LIMIT 100`,
  );
  return { status: 200, body: { count: rows.length, items: rows } };
});

route('POST', /^\/api\/quotes$/, async (req) => {
  const session = auth(req);
  if (!session) return { status: 401, body: { error: 'missing or invalid token' } };

  const { customerName, items, note } = await readJson(req);
  if (!customerName || !Array.isArray(items) || items.length === 0) {
    return { status: 400, body: { error: 'customerName and a non-empty items array are required' } };
  }

  try {
    const result = transaction(() => {
      // Derive the quote number from a sequence so two concurrent requests never collide.
      const seq = get("SELECT COALESCE(MAX(id), 0) + 1 AS next FROM quotes").next;
      const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      const quoteNo = `Q-${stamp}-${String(seq).padStart(4, '0')}`;

      let subtotal = 0;
      const lines = [];

      for (const item of items) {
        const qty = Number(item.qty);
        if (!Number.isInteger(qty) || qty <= 0) throw new Error(`invalid qty for product ${item.productId}`);

        const product = get('SELECT id, sku, unit_price, stock_qty FROM products WHERE id = ?', [item.productId]);
        if (!product) throw new Error(`product ${item.productId} not found`);
        if (product.stock_qty < qty) {
          throw new Error(`insufficient stock for ${product.sku}: requested ${qty}, available ${product.stock_qty}`);
        }

        const unitPrice = Number(product.unit_price);
        const lineTotal = Number((unitPrice * qty).toFixed(2));
        subtotal += lineTotal;
        lines.push({ productId: product.id, sku: product.sku, qty, unitPrice, lineTotal });
      }

      subtotal = Number(subtotal.toFixed(2));
      const taxRate = 0.06;
      const total = Number((subtotal * (1 + taxRate)).toFixed(2));

      const inserted = run(
        `INSERT INTO quotes (quote_no, customer_name, created_by, subtotal, tax_rate, total)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [quoteNo, customerName, session.uid, subtotal, taxRate, total],
      );
      const quoteId = Number(inserted.lastInsertRowid);

      for (const line of lines) {
        run(
          `INSERT INTO quote_items (quote_id, product_id, qty, unit_price, line_total)
           VALUES (?, ?, ?, ?, ?)`,
          [quoteId, line.productId, line.qty, line.unitPrice, line.lineTotal],
        );
        run('UPDATE products SET stock_qty = stock_qty - ?, updated_at = datetime(\'now\') WHERE id = ?', [
          line.qty,
          line.productId,
        ]);
      }

      return { id: quoteId, quoteNo, customerName, subtotal, taxRate, total, lines, note: note || null };
    });

    return { status: 201, body: result };
  } catch (err) {
    return { status: 400, body: { error: err.message } };
  }
});

route('GET', /^\/api\/quotes\/(\d+)$/, (req, [id]) => {
  const session = auth(req);
  if (!session) return { status: 401, body: { error: 'missing or invalid token' } };

  const quote = get(
    `SELECT q.*, u.email AS created_by FROM quotes q JOIN users u ON u.id = q.created_by WHERE q.id = ?`,
    [Number(id)],
  );
  if (!quote) return { status: 404, body: { error: 'quote not found' } };

  const items = all(
    `SELECT qi.id, qi.qty, qi.unit_price, qi.line_total, p.sku, p.name
       FROM quote_items qi JOIN products p ON p.id = qi.product_id
      WHERE qi.quote_id = ?`,
    [Number(id)],
  );
  return { status: 200, body: { ...quote, items } };
});

// ---------------------------------------------------------------- server

export function createApp() {
  return createServer(async (req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
        'Access-Control-Allow-Methods': 'GET, POST, PATCH, DELETE, OPTIONS',
      });
      return res.end();
    }

    const url = new URL(req.url, `http://${req.headers.host}`);
    const match = routes.find((r) => r.method === req.method && r.pattern.test(url.pathname));
    if (!match) return send(res, 404, { error: 'not found', path: url.pathname });

    try {
      const result = await match.handler(req, url.pathname.match(match.pattern).slice(1), url);
      send(res, result.status, result.body);
    } catch (err) {
      console.error('[server] handler error:', err);
      send(res, 500, { error: err.message });
    }
  });
}

const isMain =
  process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (isMain) {
  initDb();
  createApp().listen(PORT, () => {
    console.log(`[server] listening on http://localhost:${PORT}`);
    console.log(`[server] database: ${process.env.DB_PATH || 'server/data/portal.db'}`);
  });
}

export { db, initDb, all, get, run, transaction };
