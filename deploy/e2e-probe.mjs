// Targeted probe: read the app's live state from the WebView and exercise the
// candidate list the same way apiBase.js does, printing each attempt.
import { execFileSync } from 'node:child_process';

const ADB = process.env.ADB || 'adb';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const raw = execFileSync(ADB, ['shell', 'cat', '/proc/net/unix'], { encoding: 'utf8' });
const socket = raw.match(/(webview_devtools_remote_\d+)/)[1];
execFileSync(ADB, ['forward', 'tcp:9333', `localabstract:${socket}`]);
const list = await (await fetch('http://127.0.0.1:9333/json')).json();
const page = list.find((t) => t.type === 'page') || list[0];
console.log('page:', page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const send = (method, params = {}) =>
  new Promise((resolve, reject) => {
    const msgId = ++id;
    pending.set(msgId, { resolve, reject });
    ws.send(JSON.stringify({ id: msgId, method, params }));
  });
ws.addEventListener('message', (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) reject(new Error(JSON.stringify(msg.error)));
    else resolve(msg.result);
  }
});
await new Promise((r) => ws.addEventListener('open', r));
await send('Runtime.enable');

const evaluate = async (expression) => {
  const res = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
  if (res.exceptionDetails) return { __error: res.exceptionDetails.text };
  return res.result.value;
};

console.log('--- localStorage keys ---');
console.log(JSON.stringify(await evaluate(`Object.fromEntries(Object.entries(localStorage))`)));

console.log('--- fetch each candidate ---');
const candidates = ['http://192.168.37.200:4000/api', 'http://localhost:4000/api', 'http://10.0.2.2:4000/api'];
for (const base of candidates) {
  const out = await evaluate(`(async () => {
    const t0 = performance.now();
    try {
      const c = new AbortController();
      const timer = setTimeout(() => c.abort(), 3000);
      const res = await fetch('${base}/health', { signal: c.signal, cache: 'no-store' });
      clearTimeout(timer);
      const text = await res.text();
      return { base: '${base}', status: res.status, ms: Math.round(performance.now() - t0), body: text.slice(0, 80) };
    } catch (e) {
      return { base: '${base}', error: String(e), ms: Math.round(performance.now() - t0) };
    }
  })()`);
  console.log(JSON.stringify(out));
}

console.log('--- resolved module state (re-evaluate probe) ---');
const again = await evaluate(`(async () => {
  const mods = Object.keys(window).filter((k) => k.includes('api'));
  return { origin: location.origin, href: location.href, keys: mods };
})()`);
console.log(JSON.stringify(again));

ws.close();
process.exit(0);
