/**
 * Minimal Chrome DevTools Protocol client for an Android WebView.
 *
 * Playwright's connectOverCDP needs browser-level context management, which a
 * WebView target does not expose. A page-level WebSocket is enough: we only need
 * Runtime.evaluate to drive the real DOM.
 *
 * Prerequisites:
 *   adb -s emulator-5554 forward tcp:9222 localabstract:webview_devtools_remote_<pid>
 *   adb -s emulator-5554 shell am start -n com.weisheng.stockportal/.MainActivity
 *
 * Usage: node android.cdp.mjs
 */

const DEVTOOLS = process.env.DEVTOOLS_URL || 'http://127.0.0.1:9222';

const targets = await (await fetch(`${DEVTOOLS}/json/list`)).json();
const target = targets.find((t) => t.type === 'page') || targets[0];
if (!target?.webSocketDebuggerUrl) {
  console.error('[cdp] no page target found');
  process.exit(1);
}
console.log(`[cdp] target: ${target.title} @ ${target.url}`);

const ws = new WebSocket(target.webSocketDebuggerUrl);
let nextId = 1;
const pending = new Map();
const consoleErrors = [];

ws.addEventListener('message', (event) => {
  const msg = JSON.parse(event.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(msg.error.message));
    else resolve(msg.result);
  }
  if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') {
    consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' '));
  }
});

await new Promise((resolve, reject) => {
  ws.addEventListener('open', resolve, { once: true });
  ws.addEventListener('error', reject, { once: true });
});

const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const id = nextId++;
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });

await send('Runtime.enable');

/** Evaluate an expression in the page and return its JSON value. */
async function evaluate(expression) {
  const { result, exceptionDetails } = await send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (exceptionDetails) throw new Error(exceptionDetails.text || 'evaluation failed');
  return result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Poll an expression until it is truthy, up to a timeout. */
async function waitFor(expression, { timeout = 15000, label = expression } = {}) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await evaluate(expression)) return true;
    await sleep(250);
  }
  throw new Error(`timeout waiting for: ${label}`);
}

const results = [];
const step = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ' - ' + detail : ''}`);
};

// Helpers injected once; every later step can just call them.
const HELPERS = `
window.__t = {
  q: (sel) => document.querySelector(sel),
  all: (sel) => Array.from(document.querySelectorAll(sel)),
  text: (sel) => (document.querySelector(sel)?.innerText || '').trim(),
  type: (sel, value) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('missing ' + sel);
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return el.value;
  },
  click: (sel) => {
    const el = document.querySelector(sel);
    if (!el) throw new Error('missing ' + sel);
    el.click();
    return true;
  },
  clickText: (sel, needle) => {
    const el = Array.from(document.querySelectorAll(sel)).find((n) => n.innerText.includes(needle));
    if (!el) throw new Error('no ' + sel + ' matching ' + needle);
    el.click();
    return true;
  },
};
true;
`;

try {
  await evaluate(HELPERS);

  // Start from a clean session so the run is repeatable.
  await evaluate(`localStorage.clear(); true`);
  await send('Page.enable');
  await send('Page.reload', { ignoreCache: false });
  await waitFor(`!!document.querySelector('form.card')`, { label: 'login form' });
  await evaluate(HELPERS);
  step('login screen rendered inside APK', true);

  await evaluate(`__t.type('input[type="email"]', 'admin@portal.local')`);
  await evaluate(`__t.type('input[type="password"]', 'demo1234')`);
  await evaluate(`__t.click('button[type="submit"]')`);

  await waitFor(`document.querySelectorAll('ul.md\\\\:hidden li').length > 3`, {
    label: 'product cards after login',
  });
  await evaluate(HELPERS);

  const productCount = await evaluate(`document.querySelectorAll('ul.md\\\\:hidden li').length`);
  const firstProduct = await evaluate(`__t.text('ul.md\\\\:hidden li')`);
  step('APK logged in and fetched live data', productCount > 3, `${productCount} products`);

  const tokenState = await evaluate(
    `localStorage.getItem('portal.token') ? 'token-present' : 'no-token'`,
  );
  step('JWT persisted from native login', tokenState === 'token-present', tokenState);

  // The decisive check: the request reached the LAN host, not a local stub.
  const apiUsed = await evaluate(`
    (async () => {
      const t = localStorage.getItem('portal.token');
      const base = window.__API_BASE__ || 'http://192.168.37.142:4000/api';
      const res = await fetch(base + '/products?q=PT-0102', { headers: { Authorization: 'Bearer ' + t } });
      const body = await res.json();
      return { status: res.status, count: body.count, sku: body.items?.[0]?.sku };
    })()
  `);
  step('direct API call from WebView succeeds', apiUsed.status === 200 && apiUsed.count === 1, JSON.stringify(apiUsed));

  // Server-side search through the UI.
  await evaluate(`__t.type('input[placeholder="Search SKU or product name"]', 'grinder')`);
  await evaluate(`__t.click('button.btn-primary')`);
  await waitFor(`document.querySelectorAll('ul.md\\\\:hidden li').length === 1`, {
    label: 'single search result',
  });
  const searched = await evaluate(`__t.text('ul.md\\\\:hidden li')`);
  step('server-side search works in app', searched.includes('PT-0102'), searched.split('\n')[0]);

  // Low-stock filter.
  await evaluate(`__t.clickText('button', 'Reset')`);
  await sleep(600);
  await evaluate(`__t.clickText('button', 'Low stock only')`);
  await waitFor(`document.querySelectorAll('ul.md\\\\:hidden li').length === 3`, {
    label: 'three low-stock rows',
  });
  step('low-stock filter returns 3 rows', true);

  // Quotation creation from the native app.
  await evaluate(`__t.clickText('nav button', 'Quotation')`);
  await waitFor(`!!document.querySelector('input[placeholder="e.g. drill, PT-0101"]')`, {
    label: 'quotation builder',
  });
  await evaluate(HELPERS);
  step('quotation builder opens in app', true);

  await evaluate(`__t.type('input[placeholder="e.g. drill, PT-0101"]', 'drill')`);
  await sleep(400);
  await evaluate(HELPERS);
  await evaluate(`
    (() => {
      const row = Array.from(document.querySelectorAll('li')).find((n) => n.innerText.includes('PT-0101'));
      const btn = row.querySelector('button');
      btn.click();
      return true;
    })()
  `);
  await evaluate(`__t.type('input[placeholder="e.g. Acme Hardware Sdn Bhd"]', 'Android App Customer')`);
  await sleep(400);
  await evaluate(HELPERS);

  const summary = await evaluate(`__t.text('aside dl')`);
  step('totals recalculate in app', summary.includes('289.00'), summary.replace(/\n/g, ' | '));

  await evaluate(`__t.clickText('button', 'Generate quotation')`);
  await waitFor(`Array.from(document.querySelectorAll('aside .card')).some(n => /Q-\\d{8}-\\d{4}/.test(n.innerText))`, {
    label: 'quote confirmation card',
  });
  const quoteText = await evaluate(`
    (() => {
      const card = Array.from(document.querySelectorAll('aside .card')).find(n => /Q-\\d{8}-\\d{4}/.test(n.innerText));
      return card ? card.innerText : '';
    })()
  `);
  const quoteNo = quoteText.match(/Q-\d{8}-\d{4}/)?.[0];
  step('quotation written from APK', Boolean(quoteNo), quoteNo || 'none');

  step('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 2).join(' | ') || 'clean');
} catch (err) {
  step('android webview run', false, err.message);
} finally {
  ws.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
