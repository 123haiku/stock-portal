// Read the running app's resolved API base and confirm product data loads over
// that base (public Cloudflare hostname after a cold start).
import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB || 'adb';
const raw = execFileSync(ADB, ['shell', 'cat', '/proc/net/unix'], { encoding: 'utf8' });
const socket = raw.match(/(webview_devtools_remote_\d+)/)[1];
execFileSync(ADB, ['forward', 'tcp:9333', `localabstract:${socket}`]);

const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find((t) => t.type === 'page') || list[0];
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const i = ++id;
    pending.set(i, { resolve, reject });
    ws.send(JSON.stringify({ id: i, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) return { __error: res.exceptionDetails.text };
  return res.result.value;
};

console.log('base:', await evaluate(`localStorage.getItem('portal.apiBase')`));
console.log(
  'products:',
  JSON.stringify(
    await evaluate(`(async () => {
      const base = localStorage.getItem('portal.apiBase');
      const token = localStorage.getItem('portal.token');
      const res = await fetch(base + '/products?limit=3', { headers: { Authorization: 'Bearer ' + token } });
      const body = await res.json();
      return { status: res.status, count: body.count, first: body.items && body.items[0] ? body.items[0].sku : null };
    })()`),
  ),
);
const text = await evaluate('document.body.innerText');
console.log('body:', String(text).slice(0, 240).replace(/\n/g, ' | '));
ws.close();
process.exit(0);
